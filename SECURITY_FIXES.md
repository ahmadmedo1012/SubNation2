# SubNation Security Fixes Changelog

A running record of security defects identified and remediated, in
reverse-chronological order. Each entry follows the same shape so an
auditor can answer "what was wrong, what could have happened, what
did we change, how do we prove it, and how do we prevent regression?"
without reading the commits.

---

## 2026-05-19 — P0-1 — Socket.IO realtime channel was unauthenticated

**Severity:** Critical (data exposure / privacy violation)
**Status:** Fixed
**Commit:** _pending push at time of writing — see `git log` for hash_
**Files touched:**
- `backend/src/lib/socket.ts` (rewritten)
- `backend/src/lib/__tests__/socket-auth.test.ts` (new, 24 cases)
- `frontend/src/lib/socket.ts` (added `withCredentials: true`)

### Vulnerability

The Socket.IO server gated NOTHING on the WebSocket handshake.
Anonymous clients could:

1. Open `wss://subnation.ly/socket.io/` without any token.
2. Emit `socket.emit("join-user", <any_user_id>)` and start
   receiving every event the backend pushed to that user — order
   updates, wallet ledger entries, ticket replies, notification
   payloads, balance changes.
3. Emit `socket.emit("join-admin")` and start receiving the
   ENTIRE admin event stream — every admin alert, every order
   change broadcast, every system signal.

The defect was a literal blank-cheque trust pattern in the original
handler:

```ts
// pre-fix code
io.on("connection", (socket) => {
  socket.on("join-user", (userId) => {
    socket.join(`user:${userId}`);          // any client, any id
  });
  socket.on("join-admin", () => {
    socket.join("admin-room");               // any client, no check
  });
});
```

The HTTP layer was correct (every authenticated route went through
the `requireUser` / `requireAdmin` middlewares which read the
`auth_token` / `admin_token` httpOnly cookies). The realtime layer
existed in parallel and had no equivalent gate.

### Impact (worst-case attacker capability)

- Real-time observation of every other user's order activity,
  wallet movements, support tickets, and notifications — keyed
  by user ID, which is a small monotonically-increasing integer
  trivially enumerable.
- Real-time admin event stream visible to any anonymous browser tab
  that emits `join-admin`. Includes operational alerts (Sentry-
  surfaced incidents echoed via the realtime feed), inventory
  alerts, support escalations.
- No audit trail — the original handler logged "joined room" at
  debug level only, and only included the requested room name, not
  any verified principal.

### Attack window

Present from the moment Socket.IO was wired into production. No
public exploit observed before the fix landed.

### Fix design

Three layers, defense in depth:

1. **Connection-time auth gate.** `io.use((socket, next) => …)`
   middleware reads cookies from `socket.handshake.headers.cookie`
   and the explicit `socket.handshake.auth.{userToken, adminToken}`
   fields (the explicit form is for cross-origin deployments where
   browsers omit cookies). For each token, calls the same
   `verifyUserTokenDetailed` / `verifyAdminTokenDetailed` helpers
   the HTTP middlewares use — same secrets, same expiry, same
   error semantics. Connection is rejected with `Error("unauthorized")`
   when neither verifies.

2. **Room-join authorization.** Pure functions
   `authorizeJoinUser(identity, requestedUserId)` and
   `authorizeJoinAdmin(identity)` decide whether a given
   join request is honored. `join-user` only honors the
   verified user ID — the requested ID is checked with a strict
   type gate (rejects single-element arrays, NaN, Infinity, objects)
   and integer comparison. `join-admin` requires `identity.isAdmin
   === true` (strict equality, no truthy coercion).

3. **Silent rejection.** Forged join requests log the attempt at
   `warn` level (so SOC and Sentry pick it up) and return without
   joining the room. The client sees identical behavior to a
   successful join — silence — so attackers cannot use the response
   to enumerate which user IDs exist or to learn the gate's
   internals.

### Regression protections

- **Pure-function auth helpers exported from `lib/socket.ts`** —
  `parseCookieHeader`, `authenticateSocketHandshake`,
  `authorizeJoinUser`, `authorizeJoinAdmin`. Every gate decision is
  testable without spinning up a real socket.io server.

- **24-case vitest suite at `lib/__tests__/socket-auth.test.ts`**
  covers:
  - Missing cookie / empty cookie / malformed cookie
  - Cookie with no auth token / with admin token only / with both
  - Wrong-secret token (admin JWT presented as user token)
  - Forged userId on `join-user` (numeric, string, single-element
    array `[42]`, NaN, Infinity, objects, booleans)
  - User-only socket emitting `join-admin`
  - Admin socket emitting `join-admin` (positive case)
  - Truthy-but-not-strict-`true` `isAdmin` value (defense in depth)

  Every test exercises real `signUserToken` / `signAdminToken` —
  no mocks, no shortcuts.

- **Metric `socket_auth_rejected_total{reason}`** lazily registered
  with three labels: `no_token`, `forged_user`, `forged_admin`.
  Surfaces in `/api/metrics`. Forgery attempts are now observable
  to Prometheus / Grafana / any external dashboard without code
  changes.

- **Logger context** on every rejection includes the socket id,
  the verified principal (if any), the requested principal, and
  the remote address (CF-Connecting-IP-aware via the existing
  `cloudflareClientIp` middleware). Enough to tie an attempt to a
  Cloudflare WAF event or a security incident.

### How to verify the fix is live (post-deploy)

```bash
# 1. Anonymous handshake — must fail with "unauthorized"
node -e '
const { io } = require("socket.io-client");
const s = io("wss://subnation.ly", { withCredentials: false });
s.on("connect_error", (err) => { console.log("rejected:", err.message); process.exit(0); });
s.on("connect", () => { console.log("FAIL: connected without auth"); process.exit(1); });
'

# 2. Authenticated handshake (replace COOKIE with a real auth_token):
node -e '
const { io } = require("socket.io-client");
const s = io("wss://subnation.ly", {
  extraHeaders: { Cookie: "auth_token=YOUR_JWT" },
});
s.on("connect", () => { console.log("OK: authenticated"); process.exit(0); });
'

# 3. Forged join-user (authenticated as user 1, attempts to join user 2):
#    The server logs "join-user rejected — identity mismatch" but
#    silently no-ops at the wire. No room is joined.

# 4. Check the metric:
curl https://subnation.ly/api/metrics | grep socket_auth_rejected
```

### Forward-looking recommendations

1. **Add Cloudflare Zero Trust on `/socket.io/`** — even with the
   in-process gate, terminating unauthenticated connection attempts
   at the CF edge spares the origin from exhaustion attempts.
   Cost: a Cloudflare Page Rule, no code change.

2. **Move admin-event delivery to a separate namespace.** Today,
   `admin-room` is a room inside the default namespace. If an
   admin's auth ever degrades to user-only (admin JWT expires but
   user JWT does not), they remain connected and the admin events
   still target a room the socket can theoretically reach. Moving
   to `/admin` namespace with its own `io.of("/admin").use(...)`
   gate guarantees admin events flow only over admin-authenticated
   sockets. Defer until an admin-token rotation strategy is in
   place.

3. **Periodic token re-verification.** A long-lived socket
   (Socket.IO defaults reconnect indefinitely) holds the identity
   it was issued at handshake time. If a user is banned mid-
   session, the socket keeps receiving events. Add a 5-minute
   re-check that re-runs `verifyUserTokenDetailed` and force-
   disconnects on failure.

4. **Same-origin handshake assertion.** The CORS allowlist via
   `APP_ORIGINS` is correct, but socket.io's CORS check happens at
   the polling-transport upgrade. Adding an explicit `Origin`
   check inside `io.use` (reject if `socket.handshake.headers.origin`
   is not in the allowlist) closes a small gap where a
   misconfigured CORS allowlist would otherwise let a foreign
   origin connect. Currently low-risk because the origins are
   pinned to `subnation.ly` + `www.subnation.ly`.

5. **Gate `outbound emitters by principal in addition to room.**
   Belt and suspenders: `emitToUser(userId, …)` could double-check
   that the socket(s) it's targeting still have a verified
   identity matching `userId`. Today the gate at room-join time
   guarantees this, but a defense-in-depth check at emit time
   would catch any future regression in the join path.

---

_Future entries will follow the same format. New findings should
be added at the top with a date prefix._
