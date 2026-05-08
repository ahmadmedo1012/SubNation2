# Configuration

Use `config/env.example` as the source of truth for local environment variables.

The root scripts load environment files in this order. Later files override earlier files, but values already exported in your shell win over file values:

1. `.env`
2. `.env.local`
3. `config/.env`
4. `config/.env.local`

Do not commit real secrets. Keep production values in your deployment provider or local ignored env files.
