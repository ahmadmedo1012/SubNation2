# www → apex 301 at Traefik — SubNation Canonical-Host Change

> Status: **EXECUTED 2026-10-07 (R121)** — live as a **single-hop permanent
> redirect** via the standalone dynamic router
> `/data/coolify/proxy/dynamic/www-redirect.yml` (priority 1000; the §3
> "Alternative" shape). **R122 verification (2026-10-07 23:30Z):** consistent
> live probes (HTTP/2 + HTTP/1.1, bare root + path + query, full header
> inspection) return **HTTP/2 301** with path+query preserved — the R121
> record's "308" digit was wrong; behavior is exactly as required either
> way. This doc is preserved as the design + rollback record. **R124
> update (2026-10-09):** the digit is Traefik-regen-dependent — **308
> before the R124 redeploy, 301 after it** (stable ×3, commit `09857fc`).
> Both earlier records were real observations. §3's comment below explains
> the 308: Traefik `redirectRegex` + `permanent: true` emits 308 by design.
> Decision + evidence recorded in
> `docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` §8 (R117 addendum, observed
> 2026-10-05); this doc adds the paste-able config it asked for
> (R118-A7 F34(c)). Companion: `docs/operations/CONTABO_COOLIFY_OPERATIONS.md`
> §5 (the Traefik layer); operator summary: `OPERATIONS_RUNBOOK.md` §13.

## 1. The decision (already made by the codebase)

**The canonical host is the apex `https://subnation.ly`.** Every
canonical signal in the product already points there (R117-A4 live
observations, 2026-10-05):

- sitemap.xml — all 56 `<loc>` entries are apex URLs,
- robots.txt — `Sitemap:` is apex,
- og:image / og URLs — apex,
- runtime `<link rel="canonical">` — apex, plus the **static** canonical
  baked into `frontend/index.html:63` since R117 (verified present in the
  build output by R117-V2).

Executed 2026-10-07: www → apex **308** (path + query preserved — the R121
regen state; **301 since the R124 redeploy 2026-10-09**, see the header
note); apex 200.
(Pre-R121 both hostnames answered 200 byte-identical — R118 record,
verified `R118-A7-docs.md` §1.) A single live hostname per site is what
the canonical signals below were aiming at; the redirect is now in force
at the Traefik layer.

## 2. Why the redirect lives at Traefik — NOT in-app, NOT Cloudflare

- **Not in-app.** The R116 Cloudflare-loop incident is exactly why the
  in-app redirect was removed (`f10bb9b`, 2026-10-05): an app-layer
  hostname redirect combined with edge/proxy behavior created a redirect
  loop. Re-adding it at the app layer would recreate that loop class
  (CLOUDFLARE_FINAL_CUTOVER §8:168-173).
- **Not Cloudflare.** The zone is **DNS-only (grey)** — there is no
  Cloudflare edge in the live path. A Cloudflare redirect rule would
  require re-proxing the zone first, which is a separate, deliberately
  pending decision (R118-A6 F-3 — see
  `docs/operations/NEON_COLD_START_RUNBOOK.md` §6). Do not couple the two.
- **Yes Traefik.** Both Host routers (`subnation.ly` and `www.subnation.ly`)
  already live there — Coolify generated them from the resource's Domains
  config, and Let's Encrypt certs for both hostnames are managed there
  (COOLIFY_FINAL_SETUP §6). One middleware turns the www router into the
  redirect. Stateless; rollback = delete it.

## 3. The paste-able config

### Step 1 — the middleware (Traefik dynamic config via Coolify)

Coolify → **Server → Proxy → Dynamic Configurations** → add a file
(e.g. `subnation-www-redirect.yaml`):

```yaml
http:
  middlewares:
    subnation-www-to-apex:
      redirectRegex:
        regex: '^https://www\.subnation\.ly/(.*)'
        replacement: 'https://subnation.ly/${1}'
        permanent: true   # permanent redirect — Traefik redirectRegex emits 308 for this shape (the R121/R124-pre-redeploy live answer); the 301s observed post-redeploy come from the regen state
```

This is the whole rule: any `https://www.subnation.ly/<anything>` →
`https://subnation.ly/<anything>` as a permanent single-hop (301 or 308
depending on Traefik regen state). The `(.*)` capture
carries the path **and query string** through to the replacement, so URLs
like `/product/x?ref=y` redirect losslessly.

### Step 2 — wire it to the www router (keep BOTH domains attached)

Keep `https://subnation.ly` **and** `https://www.subnation.ly` attached to
the SubNation resource in Coolify (§1 of this doc's premise: the www cert
must keep being issued/renewed — the redirect happens after TLS).

Coolify → the SubNation **application resource → Advanced → Custom Docker
Labels** (the label editor) — find the router whose rule is the www host,
e.g. the label containing:

```
traefik.http.routers.<generated-name>.rule=Host(`www.subnation.ly`)
```

and add to that same router (append to the existing list if a
`middlewares` label is already there):

```
traefik.http.routers.<generated-name>.middlewares=subnation-www-to-apex@file
```

`@file` = "defined in a dynamic-config file" (Step 1). Save; Traefik
hot-reloads — no proxy restart needed.

> Coolify regenerates the label block when you change the resource's
> Domains later — re-check that the `middlewares` line survived any such
> edit.

### Alternative — pure dynamic config (no label edits)

If you would rather not touch the resource labels, put a standalone router
in the same dynamic-config file, with a priority that beats the
Coolify-generated www router:

```yaml
http:
  middlewares:
    subnation-www-to-apex:
      redirectRegex:
        regex: '^https://www\.subnation\.ly/(.*)'
        replacement: 'https://subnation.ly/${1}'
        permanent: true
  routers:
    subnation-www-redirect:
      rule: "Host(`www.subnation.ly`)"
      entryPoints:
        - http
        - https
      priority: 1000
      middlewares:
        - subnation-www-to-apex
      service: noop@internal
      tls:
        certResolver: <copy the resolver name from your resource's generated labels>
```

Caveats: the `certResolver` name is Coolify-version-specific (copy it from
the TLS labels Coolify generated for the apex router), and this router
fights the generated one on rule-tie — the explicit `priority` decides.
The label path (Step 2) is preferred: it keeps cert management 100%
Coolify's.

## 4. Verify (2 minutes)

```bash
# 1. www redirects, path preserved:
curl -sI https://www.subnation.ly/ | head -n 5
#    expect: HTTP/2 301  +  location: https://subnation.ly/

curl -sI https://www.subnation.ly/product/some-slug | head -n 5
#    expect: 301 → https://subnation.ly/product/some-slug

# 2. apex untouched:
curl -sI https://subnation.ly/ | head -n 3          # expect: 200
curl -s  https://subnation.ly/api/healthz/summary   # expect: {"status":"ok"}
curl -sI https://subnation.ly/api/healthz | head -n 3   # expect: 200
curl -sI https://subnation.ly/healthz/live  | head -n 3 # expect: 200

# 3. re-run the health census (FINAL_MONITORING weekly checklist):
curl -s https://subnation.ly/api/catalog/stats      # products/units counts
docker ps --format 'table {{.Names}}\t{{.Status}}'  # on the VM: both (healthy)

# 4. exactly ONE redirect hop — the loop lesson:
curl -sIL -o /dev/null -w '%{num_redirects} %{url_effective}\n' https://www.subnation.ly/
#    expect: 1  https://subnation.ly/
```

If any check fails, roll back (§5) first, diagnose second.

## 5. Rollback

The change is stateless — remove it and the previous behavior returns
immediately:

1. Delete the `middlewares` line from the www router's labels (Step 2),
   **or** delete the whole dynamic-config file (Step 1 / alternative),
2. Confirm: `curl -sI https://www.subnation.ly/` → 200 again (www serving
   the app directly, as today).

No data, DNS, or certificate is touched by either the change or its
rollback. Certificates for both hostnames stay managed by Coolify as long
as both domains remain attached to the resource (do NOT remove the www
domain — that would stop its cert renewal).

## 6. Standing caveat — Cloudflare proxy

**Do not combine this 301 with a Cloudflare proxy re-enable until the
R116 loop lesson has been re-checked end-to-end.** If the zone is ever
moved to proxied (orange) — a separate pending decision
(`docs/operations/NEON_COLD_START_RUNBOOK.md` §6) — then: edge caches can
persist 301s, and "Always Use HTTPS" + origin redirects can chain. After
any re-proxy, re-run §4 check 4 (exactly one hop) on both hostnames and
re-read `CLOUDFLARE_FINAL_CUTOVER.md` §1–§4 vs §8 first.
