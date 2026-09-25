# Oracle VM Final Setup — SubNation2 production host

> r112 runbook for the **VM only**: bare Oracle Cloud instance → hardened Ubuntu
> host with Docker + Coolify ready. Supersedes the setup *detail* of
> `COOLIFY_ORACLE_MIGRATION.md` §4 (r107) without changing the architecture; it
> expands `MIGRATION_RUNBOOK.md` Phase 2. Deploying the stack is Phase 3+.
>
> Target: Cloudflare (DNS/proxy) → this VM → Coolify (own Traefik) → `subnation`
> (this repo's Dockerfile) + `openwa` (`ghcr.io/ahmadmedo1012/openwa:sha-<short>`)
> → Neon Postgres (external `DATABASE_URL`). No app Redis.
> `SINGLE_INSTANCE_MODE=true` — never more than 1 subnation replica.
>
> Honesty: all commands real Ubuntu/aarch64. Verified live: Coolify installer
> URL/behavior, docker.com arm64 apt packages. Not sandbox-verifiable: Oracle
> console labels beyond the path shape below.

## 1. VM shape requirements

| Setting | Value | Why |
|---|---|---|
| Shape | `VM.Standard.A1.Flex` (Ampere A1, aarch64) | Always Free ARM64 compute |
| OCPU / RAM | **min 2 OCPU + 6 GB** (reference: 2/12 per migration doc §1; free ceiling 4/24) | Coolify control plane ~1.5–2 GB + Docker daemon + VM-side Node/Vite builds (~1.5–2 GB transient/deploy) + both app containers (~0.3–0.5 GB idle) + OS ~0.5 GB |
| Boot volume | 50 GB | OS + images/layers + Coolify `/data` + capped logs (≤30 MB/service) + nightly dumps; free allowance is 200 GB total |
| Image | Canonical Ubuntu 24.04 LTS, aarch64 | Matches every command below (`noble`); 22.04 also works |

Provision: Oracle console → Compute → Instances → Create instance → upload SSH key → note the public IP.

## 2. First SSH + update

```bash
ssh -i <key> ubuntu@<VM_PUBLIC_IP>
sudo apt update && sudo apt full-upgrade -y
[ -f /var/run/reboot-required ] && sudo reboot   # reconnect after
uname -m        # expect: aarch64
. /etc/os-release && echo "$VERSION_CODENAME"   # expect: noble (24.04)
```

## 3. SSH hardening (key-only, no root login)

Oracle images are key-auth by default (cloud-init); pin it explicitly. Keep the `ubuntu` sudo user — never run the stack as root.

```bash
# sshd drop-ins load FIRST and first value wins → 01- beats cloud-init's 50- file
printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' \
  'PermitRootLogin no' | sudo tee /etc/ssh/sshd_config.d/01-hardening.conf
sudo sshd -t        # syntax check — silence = OK
sudo systemctl restart ssh
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
# expect: passwordauthentication no · permitrootlogin no
```

Keep the current session open; confirm a NEW login works before closing it.

## 4. Swap (Ampere VMs ship with none)

Build spikes (pnpm install + Vite) can OOM-kill a Coolify build; swap is the safety net, not extra RAM.

```bash
sudo fallocate -l 4G /swapfile   # ext4; fallback: dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf
swapon --show    # expect: /swapfile  file  4G  0B  -2
free -h          # expect: Swap: 4.0Gi
```

(4 GB suits the 6 GB minimum shape; the 12 GB reference shape uses 2 GB — `COOLIFY_ORACLE_MIGRATION.md` §4.4.)

## 5. Docker (official apt repo, arm64)

Coolify's installer can install Docker itself, but doing it first pins the version to Docker's repo and lets `ubuntu` use it before Coolify exists.

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
exit   # reconnect (or `newgrp docker`) so the group applies
docker run --rm hello-world   # expect: "Hello from Docker!" — multi-arch, native arm64
docker ps                     # works without sudo
```

## 6. Firewall — the two-layer port contract

A port is reachable only if **BOTH** layers allow it: (1) the Oracle Cloud
Security List/NSG and (2) the host netfilter (iptables/ufw). Oracle's Ubuntu
images ship `/etc/iptables/rules.v4` (via `iptables-persistent`) whose INPUT
chain ends in a **REJECT-everything** rule — **ufw alone is NOT enough** (its
hooks are appended; the REJECT fires first): the "why can't I reach my VM" trap.

| Port(s) | Exposure | Purpose |
|---|---|---|
| 22/tcp | PUBLIC (restrict to operator IP when possible) | SSH |
| 80/tcp | PUBLIC | HTTP redirect + Let's Encrypt ACME (Cloudflare-proxied) |
| 443/tcp | PUBLIC | HTTPS + WebSocket |
| 8000/tcp | TEMPORARY/RESTRICTED | Coolify first-boot UI — close after setup |
| 3000, 3001 | NEVER PUBLIC | compose loopback debug binds (`127.0.0.1` only) |
| 8080, 2785 | NEVER PUBLIC | container-internal (subnation app / openwa gateway) |
| 5432 | NEVER PUBLIC | Postgres is external (Neon, TLS) — nothing listens locally |
| 6379 | NEVER PUBLIC | Redis not deployed in this stack |

### 6.1 Layer 1 — Oracle Cloud Security List (web console)

Path: **Compute → Instances → `<instance>` → Subnet → Security Lists** → default
list → Add Ingress Rules. The default list has one stateful ingress rule
(22/tcp from 0.0.0.0/0). Add stateful ingress rules for 80/443 (0.0.0.0/0) and
8000 (**temporary** — prefer your operator IP `/32`). Stateful = reply traffic
implicitly allowed; default egress (allow all) needs no edits. IPv6 VCN: repeat for `::/0`.

### 6.2 Layer 2 — host iptables + ufw

```bash
sudo iptables -L INPUT --line-numbers -n     # see the shipped ruleset + REJECT
LN=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')
sudo iptables -I INPUT "$LN" -m state --state NEW -p tcp --dport 80   -j ACCEPT
sudo iptables -I INPUT "$LN" -m state --state NEW -p tcp --dport 443  -j ACCEPT
sudo iptables -I INPUT "$LN" -m state --state NEW -p tcp --dport 8000 -j ACCEPT
# IPv6 VMs: repeat the three inserts with `sudo ip6tables` (same pattern)
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent  # no-op if present
sudo netfilter-persistent save     # persists to /etc/iptables/rules.v4 + rules.v6
# ufw on top (audit layer; the iptables inserts above are what actually unblock):
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp            # TEMPORARY
sudo ufw enable                    # answer y — 22 is allowed, session survives
```

**Close 8000 after the Coolify wizard (§8):**

```bash
sudo ufw delete allow 8000/tcp
sudo iptables -D INPUT -m state --state NEW -p tcp --dport 8000 -j ACCEPT
sudo netfilter-persistent save     # + delete the 8000 ingress rule in the Security List (§6.1)
```

### 6.3 Verification

```bash
sudo ufw status verbose
sudo iptables -L INPUT --line-numbers -n   # ACCEPTs for 22/80/443 sit BEFORE the REJECT
sudo ss -tlnp
```

Expected host listeners: `0.0.0.0:22` (sshd); `0.0.0.0:80/443` (docker-proxy →
Coolify's Traefik) after §8; `0.0.0.0:8000` only during setup; `127.0.0.1:3000/3001`
only if the compose stack runs with default binds; nothing on 8080/2785, 5432, 6379 — ever.

## 7. fail2ban

```bash
sudo apt-get install -y fail2ban
sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd   # expect: Currently banned: 0
```

(Ubuntu 22.04/24.04 fail2ban tails the systemd journal for sshd by default — no log-path config needed.)

## 8. Coolify installation

Prereq: 80/443 free, 8000 reachable — `sudo ss -tlnp | grep -E ':(80|443|8000)\s'` must output nothing first.

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash   # installer requires root
```

Verified against the installer script itself: requires root (exits otherwise),
installs Docker itself if missing (same repo + package set as §5), installs into
`/data/coolify`, and serves the first-boot wizard on `http://<VM_PUBLIC_IP>:8000`.
Canonical docs: https://coolify.io/docs/installation (redirects to the self-hosted start page).

Wizard: open `:8000`, create the admin account, store the password in your
password manager (not recoverable later). Then **immediately close 8000** in both
layers (§6.2 + §6.1), or restrict its Security-List source to your IP and put the
dashboard on a direct-DNS subdomain (Settings → FQDN, grey cloud — migration doc §4.5).
Deploying the stack: `MIGRATION_RUNBOOK.md` Phase 3+.

## 9. Health checks (after each phase; ALL before §10)

```bash
uname -m                          # aarch64                      (§1–2)
free -h                           # Swap: 4.0Gi                  (§4)
swapon --show                     # /swapfile file 4G            (§4)
df -h /                           # 50G boot volume, >60% free   (§1)
docker run --rm hello-world       # "Hello from Docker!" arm64   (§5)
docker ps                         # no sudo needed               (§5)
sudo ufw status verbose           # 22/80/443 (+8000 only during wizard)  (§6)
sudo iptables -L INPUT --line-numbers -n   # ACCEPTs before REJECT          (§6)
sudo ss -tlnp                     # expected-listeners table §6.3          (§6)
systemctl status docker fail2ban --no-pager  # both active (running)        (§5,§7)
```

## 10. VM READY checklist

- [ ] `uname -m` → aarch64; Ubuntu 24.04 (noble); rebooted after `full-upgrade`
- [ ] SSH: key-only + root login disabled (`sshd -T` shows both `no`); new login verified
- [ ] fail2ban active, sshd jail enabled (`fail2ban-client status sshd`)
- [ ] 4G `/swapfile` active, in `/etc/fstab`, `vm.swappiness=10` persisted
- [ ] Docker from docker.com apt repo; `hello-world` OK; `ubuntu` in `docker` group
- [ ] Security List: stateful 22/80/443 only (8000 rule deleted post-wizard)
- [ ] Host iptables: ACCEPTs before the shipped REJECT + `netfilter-persistent save`; ufw 22/80/443
- [ ] `sudo ss -tlnp` matches §6.3 — nothing public beyond 22/80/443
- [ ] Coolify wizard completed; admin password stored; 8000 closed in BOTH layers
- [ ] Hand-off: `MIGRATION_RUNBOOK.md` Phases 3–5 → `scripts/final-cutover-preflight.sh`
      before DNS cutover (§D enforces this port contract) → nightly backup via
      `scripts/backup-cron.sh` once `scripts/backup-preflight.sh` passes (cron line: `docs/DISASTER_RECOVERY.md`).

## The final firewall contract

| Port(s) | Exposure | One-line rationale |
|---|---|---|
| 22/tcp | PUBLIC | The only management path — key-only + fail2ban (restrict to operator IP when possible) |
| 80/tcp | PUBLIC | HTTP→HTTPS redirect and Let's Encrypt ACME HTTP-01; Cloudflare proxies it |
| 443/tcp | PUBLIC | All production traffic: HTTPS + Socket.IO WebSocket |
| 8000/tcp | TEMPORARY/RESTRICTED | Coolify first-boot wizard only — close (or operator-IP-only) immediately after |
| 3000, 3001 | NEVER PUBLIC | Compose debug binds, host-published to `127.0.0.1` only |
| 8080, 2785 | NEVER PUBLIC | Container-internal app/gateway ports — Traefik reaches them over the Docker network |
| 5432 | NEVER PUBLIC | Postgres lives in Neon (external, TLS) — no local listener |
| 6379 | NEVER PUBLIC | No Redis in this stack — in-memory fallbacks by design |

**Why no direct app-port exposure is needed:** the request path is Cloudflare
(DNS/proxy) → VM **80/443** → Coolify's Traefik (the only containers publishing
host ports) → `subnation`/`openwa` over the internal Docker bridge by container
name. App ports 8080/2785 never leave the bridge — no app-port rule ever exists
in either layer; the whole contract is 22/80/443 public, all else closed.

**Compose-bind verification (`ss -tlnp` reasoning):** with default env,
`docker-compose.yml` publishes `127.0.0.1:3000→8080` and `127.0.0.1:3001→2785`
(loopback host-IP prefix in `ports:`). `sudo ss -tlnp` shows docker-proxy on
**127.0.0.1:3000/3001 only** — a loopback bind means the kernel never routes
external packets to those sockets, satisfying the NEVER PUBLIC row independently
of both firewall layers (defense in depth, not instead of). In a Coolify
deployment the `ports:` mappings are removed entirely — neither 3000/3001 nor
8080/2785 appears in host `ss` output; 5432/6379 appear in neither deployment.
`scripts/final-cutover-preflight.sh` §D asserts these loopback binds automatically.
