# Lean Coffee

A free, realtime Lean Coffee meeting app for small teams (3 to 12 people) on a Teams call. The facilitator shares the Stage view; everyone else joins in a browser tab with a private link and a display name. No accounts. Results download as Word and Excel files.

- Live site: https://leancoffee-app.netlify.app (not deployed yet)
- Build brief: [`docs/handoff/`](docs/handoff/) (build prompt, functional spec, mockups, addendum)
- Decisions log: [`docs/decisions.md`](docs/decisions.md)
- Security: [`SECURITY.md`](SECURITY.md)

## Status

| Phase                         | Gate                        | Status                                                                                                           |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0 Repo and tooling            | CI green on an empty app    | Passed ([CI run](https://github.com/Spr0/LeanCoffee/actions/runs/40159127493))                                   |
| 1 Database, RLS, RPCs         | pgTAP suite green           | Passed in CI ([run](https://github.com/Spr0/LeanCoffee/actions/runs/40161071337)); not yet applied to production |
| 2 Core client and realtime    | Two-browser smoke           | Not started                                                                                                      |
| 3 Session phases              | Six-browser full session    | Not started                                                                                                      |
| 4 Export                      | Export and round-trip tests | Not started                                                                                                      |
| 5 Hardening and accessibility | Security and a11y suites    | Not started                                                                                                      |
| 6 Deploy                      | Production smoke            | Not started                                                                                                      |

## Architecture

- **Frontend:** Vite, React 19, TypeScript (strict), Tailwind CSS 4, self-hosted Plus Jakarta Sans.
- **Backend:** Supabase (Postgres, Realtime, anonymous Auth). All writes go through `SECURITY DEFINER` RPCs; Row-Level Security denies everything else.
- **Hosting:** Netlify, continuous deploy from `main`, plus a daily scheduled keep-alive function.

## Local setup

Requires Node 22 (`nvm use`).

```sh
npm install          # also points git at .githooks (gitleaks pre-commit)
cp .env.example .env.local   # fill in the project URL and publishable key
npm run dev
```

## Environment variables

| Name                            | Where                 | Notes                                   |
| ------------------------------- | --------------------- | --------------------------------------- |
| `VITE_SUPABASE_URL`             | `.env.local`, Netlify | Public by design                        |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local`, Netlify | Public by design (`sb_publishable_...`) |

Never put a `service_role` or `sb_secret_` key in the repo, the browser bundle, or any `VITE_` variable. CI fails the build if one appears in `dist`.

## Tests

| Command             | What it runs                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `npm run lint`      | ESLint (bans `dangerouslySetInnerHTML` and `innerHTML`)           |
| `npm run typecheck` | TypeScript strict                                                 |
| `npm test`          | Vitest and React Testing Library                                  |
| `npm run test:e2e`  | Playwright with axe-core (builds and serves the app)              |
| `npm run db:test`   | pgTAP against a local Supabase stack (`npx supabase start` first) |

CI (`.github/workflows/ci.yml`) runs all of these plus `npm audit --audit-level=high` and a full-history gitleaks scan.
