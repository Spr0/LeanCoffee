# Build prompt addendum: answers to the ASK SCOTT points

**Reads with:** `docs/handoff/claude-code-build-prompt.md` (2026-10-24), `docs/handoff/lean-coffee-functional-spec.md`, `docs/handoff/design/`. Where this addendum and the prompt disagree, this addendum wins.
**Date:** 2026-10-25

## Answered ASK SCOTT points

| Prompt section | Answer |
|---|---|
| Phase 0, repo | Already created: `Spr0/LeanCoffee`, **public**, contains only a README. Keep it public (security rests on RLS and secrets kept out of the repo, not code secrecy; unlimited Actions minutes; branch protection available). |
| Phase 0, Supabase | One free project only (free-plan slot limit): `Lean Coffee`, ref `dzvfedktsxomnzokeqap`, URL `https://dzvfedktsxomnzokeqap.supabase.co`. No separate test project; see Test strategy below. |
| Phase 0, credentials | Preferred: the Supabase connector (claude.ai) for migrations, SQL, project URL and anon key, so no access token sits in the environment. Fallback: environment secret `SUPABASE_ACCESS_TOKEN` with the Management API or CLI. Never in chat or the repo. Anonymous sign-ins: Scott enables in the dashboard (Authentication, Sign In / Providers) if the connector cannot; verify it is on before Phase 2. |
| Client key | Use the modern **publishable key** (`sb_publishable_...`), env var `VITE_SUPABASE_PUBLISHABLE_KEY`, instead of the legacy anon JWT (`VITE_SUPABASE_ANON_KEY` in the prompt). Already set in Netlify (builds scope). It is public by design. |
| 4.2.3, Turnstile | **Skip.** Rely on the Supabase per-IP anonymous sign-in limit. Document the residual risk in `SECURITY.md`. No Cloudflare origin in the CSP. |
| Phase 6, Netlify | **Already created:** `leancoffee-app` (`leancoffee` was taken), site ID `d0566342-b2ea-4b80-b742-e3fad88bbb14`, team `scott23henderson` (Henderson Solution), URL https://leancoffee-app.netlify.app. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set (builds scope). Linking the GitHub repo for continuous deploy needs Scott in the Netlify UI; ask at that point. |

## Decisions already made (log them in `docs/decisions.md`)

1. Board code is 8 characters (prompt wins over spec F01's 6).
2. Vote visibility keys off a `votes_revealed_at` column on `boards`, not "phase is Discuss or later", because tie-breaking happens after reveal but within the Vote phase. Same pattern per extend round (`closed_at`).
3. "Everyone has finished" counts participants with `last_seen_at` within 45 s, kept current by a `heartbeat()` RPC every 20 s. The database enforces the reveal, so presence must live in the database.
4. Spec functions missing from the prompt's Phase 3 list are in scope: F20 skip/defer/reorder, F21 re-vote, F26 lock topic submission, mid-session parking-lot topics, chime with per-person mute, auto-start-next setting. The spec's "hide topics" setting (default on) is honored by the Brainstorm RLS policy.
5. QR code (F05) goes to `docs/backlog.md`: in-person only, not useful on Teams.
7. Mockups are Claude Design exports that reference a missing `./support.js` and Google Fonts. The markup is static with inline styles and renders without it; the font may fall back. `Main`, `PhoneVote` and `StageB` load older fonts (Bricolage Grotesque, DM Sans, Space Grotesk, JetBrains Mono) from earlier design rounds: use Plus Jakarta Sans everywhere per the tokens; keep layout and color from the mockup.
6. Retention is 7 days everywhere (supersedes spec F29 and the 30-day not-found text).

## Test strategy (replaces the two-project plan and Phase 1's local-or-hosted fallback)

1. **pgTAP and RLS suite (7.2):** runs in GitHub Actions on every push against a throwaway `supabase start` stack on the runner (`supabase db reset && supabase test db`). This is Gate 1's proof. In this container, try `supabase start` too; if image pulls are throttled, rely on CI and say so.
2. **Pre-launch (Gates 3, 5, 6 and 7.5 API probing):** run against the production project while it holds no real data. This is the last point at which destructive or noisy tests are allowed there.
3. **Post-launch:** production smoke tests only. Every test board is named with an `E2E ` prefix and deleted in teardown; the 7-day purge is the backstop. Never run load or probe suites against production after launch.
4. Migrations reach production only after passing in CI. Document the residual risk (no staging database) in `SECURITY.md` and the README, with Supabase branching (paid) as the upgrade path.

## Project state at handoff (2026-10-25)

- Supabase: Postgres 17, us-east-1, `public` schema empty. `pgcrypto` installed; `pg_cron`, `pgtap`, `pg_net` available, not installed. Supabase connector is connected for migrations and SQL.
- Network policy in the setup session blocked `*.supabase.co` and `api.supabase.com` from the container; recheck at start. If still blocked, run E2E and API-probe suites in GitHub Actions.

## Environment notes from the first session

- Docker daemon is installed but not running by default (`dockerd &` starts it). Docker Hub and ECR pulls were rate-limited, so do not depend on `supabase start` locally; CI is the authoritative database test environment.
- Postgres 16 client is installed locally. LibreOffice (`soffice`) is installed for the export conversion check.
- Push after every gate. The container is ephemeral.
