# Security Policy

## Reporting a vulnerability

**Please do not open public issues for security findings.**

Use GitHub's **private security advisory** on this repo:
**Security → Report a vulnerability** (or
<https://github.com/ahmadmedo1012/SubNation2/security/advisories/new>).
Reports are seen by the maintainer directly; you can track resolution in the
private thread. If you cannot use GitHub advisories, open a regular issue
asking for a contact — do **not** include the finding itself.

We aim to acknowledge reports within 72 hours. Please allow time for a fix
before public disclosure.

> Honest note: no dedicated security email or `/.well-known/security.txt`
> exists yet — the GitHub advisory channel is the supported one today.

## Scope

- Application code in this repository: `backend/` (Express API), `frontend/`
  (React SPA), `shared/` (generated clients, schema, OpenAPI spec).
- The **live production site** <https://subnation.ly> — guest-level testing
  only (pages, public API surface, auth entry points, client-side behavior).
- The **admin surface** at a logic level (auth design, session/TOTP flows,
  RBAC) — without attempting to bypass authentication on the live system.
- Secrets handling: `config/env.example` and `deploy/env.compose.example`
  document the expected variables; no real secret should ever appear in the
  repo, logs, or output (gitleaks scans every push in CI).

## Out of scope

- Denial-of-service or load testing against the production infrastructure
  (single Contabo VM + Neon free tier — it will just fall over, which helps
  no one).
- Social engineering, phishing, or physical attacks.
- Vulnerabilities in third-party services themselves (Firebase, Telegram,
  Neon, Cloudflare) — report those to the respective providers.
- Automated scanner output without a demonstrated, concrete impact.
- Findings that require paid purchases/top-ups to demonstrate — describe the
  path instead; we can reproduce it safely.

## What we already do

- Helmet/CSP, CORS allow-list, CSRF checks, multi-tier rate limiting, admin
  2FA (TOTP), AES-256-GCM encryption of delivered credentials at rest.
- Secret scanning (gitleaks) on every push — including docs-only ones — plus
  CVE scanning of production deps (`pnpm audit --prod`) whenever the
  dependency tree changes and on a weekly schedule
  (`.github/workflows/ci.yml`).
- Security-focused audit rounds with published reports under
  `docs/inspection-r###/`.
