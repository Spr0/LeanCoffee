# Lean Coffee

A free, realtime Lean Coffee meeting app for small teams (3 to 12 people) on a Teams call. The facilitator shares the Stage view; everyone else joins in a browser tab with a private link and a display name. No accounts. Results download as Word and Excel files.

- Live site: https://leancoffee-app.netlify.app
- Build brief: [`docs/handoff/`](docs/handoff/) (build prompt, functional spec, mockups, addendum)
- Decisions log: [`docs/decisions.md`](docs/decisions.md)
- Security: [`SECURITY.md`](SECURITY.md)

## Status

| Phase                         | Gate                        | Status                                                                                                                   |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0 Repo and tooling            | CI green on an empty app    | Passed ([CI run](https://github.com/Spr0/LeanCoffee/actions/runs/40159127493))                                           |
| 1 Database, RLS, RPCs         | pgTAP suite green           | Passed in CI ([run](https://github.com/Spr0/LeanCoffee/actions/runs/40161071337)) and applied to production (2026-10-25) |
| 2 Core client and realtime    | Two-browser smoke           | Passed ([CI run](https://github.com/Spr0/LeanCoffee/actions/runs/40170418600))                                           |
| 3 Session phases              | Six-browser full session    | Passed ([CI run](https://github.com/Spr0/LeanCoffee/actions/runs/40190087572))                                           |
| 4 Export                      | Export and round-trip tests | Passed ([CI run](https://github.com/Spr0/LeanCoffee/actions/runs/40194387985))                                           |
| 5 Hardening and accessibility | Security and a11y suites    | Passed ([CI run](https://github.com/Spr0/LeanCoffee/actions/runs/40198182297))                                           |
| 6 Deploy                      | Production smoke            | Not started                                                                                                              |

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

## Export caveat

Word and Excel files are generated in the browser (`docx`, `exceljs`). CI checks them by reading them back and converting them with headless LibreOffice; real Microsoft Word and Excel were not available in CI. Open one sample of each in Word and Excel before relying on them. CI keeps samples as the `export-samples` artifact.

## Deployment

Netlify builds every push from GitHub (`netlify.toml`): `npm run build`, then `scripts/check-dist-keys.mjs` scans the real bundle for privileged keys. Production is `main`; other branches get branch-deploy previews at `https://<branch>--leancoffee-app.netlify.app` (slashes become dashes).

| Netlify environment variable    | Scopes | Value                                            |
| ------------------------------- | ------ | ------------------------------------------------ |
| `VITE_SUPABASE_URL`             | All    | `https://dzvfedktsxomnzokeqap.supabase.co`       |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | All    | the project's publishable key (public by design) |

The build fails if `VITE_SUPABASE_URL` is missing, because the security headers (`dist/_headers`) are generated from it.

Before promoting to production, run the browser suite against the preview:

```sh
E2E_BASE_URL=https://<branch>--leancoffee-app.netlify.app npx playwright test e2e/smoke.spec.ts e2e/security.spec.ts e2e/two-browsers.spec.ts
```

## Keeping the free database awake

Supabase pauses free projects after 7 days with little activity. Two independent jobs call the `keepalive()` function once a day:

1. **Netlify scheduled function** `netlify/functions/keepalive.mts` (`@daily`, UTC). Runs only on the published production deploy. Netlify shows its runs under Logs, Functions.
2. **GitHub Actions** `.github/workflows/keepalive.yml` (06:23 UTC daily, also runnable by hand from the Actions tab). GitHub can disable scheduled workflows in repositories with no recent activity, which is why there are two.

**If the project is paused anyway:** open the Supabase dashboard, choose the project, and select **Resume project**. Paused free projects can be restored for up to a year after pausing. Data is kept while paused. After resuming, open the app once to confirm it loads.
