# Release Radar — agent instructions

Self-hosted TV-series and movie release browser for **radar.pkubelka.cz**,
built on Cloudflare Workers + Neon Postgres. See README.md for architecture
(Worker, Neon, GitHub Actions sync/deploy, migrations).

## Local entrypoints

- `npm run typecheck` — TypeScript gate. `npm run test` — test suite.
- `npm run dev` — local dev. `npm run deploy` — production deploy (authorised
  operators only; never deploy to prove context adoption).
- `npm run db:migrate:postgres` — Neon schema migration.
- CI: `.github/workflows/deploy.yml` (type-checks PRs, deploys master),
  `sync.yml`. Preserve all existing gates.

## Shared guidance and Context Fabric (prepare-only, L1 informative)

- Profile: app-service, level L1 informative. Graft: not applicable (Worker
  codebase with no supported graph need stated; each checkout would own its
  cache if ever adopted).
- Adopted shared-guidance pin (reviewed immutable revision; active sessions
  keep their previous valid pin):
  - sourceRepo: `KSonny4/engineering-guidance`
  - revision: `656d5569f261afb75f7c7685bea55e1e71518f9b`
  - paths: `AGENTS.md`, `standards/context.md`
  - sha256: `98c72a903daf02f52b080a5ba5acac2459b69913040c48bb61b471867123eb4c`,
    `e2c9a66a09472eb8a99c06387063b85254565fdb40903b3ea16ad0c4454b4f3a`
- Task-based loading: fetch the pinned files, verify bytes against the hashes
  above, and supply them to the receiving agent before dependent work.
  Missing or mismatched guidance blocks the dependent action.
- Context Fabric search (interface v0.1 PROPOSED, unshipped): pending
  activation. No client is wired in this change; no endpoint is configured.
  Calendar tokens, TMDB/TVmaze keys, and Neon credentials never enter shared
  context or PR text.
- Public-repo boundary: this file carries integrity metadata only — no
  private guidance text, excerpts, hostnames beyond the public service
  domain, or credentials.
- Status: prepared (reviewable candidate). Adopted/loaded/indexed/verified
  remain pending until the shared runtime is published and the adoption is
  completed and re-verified.
