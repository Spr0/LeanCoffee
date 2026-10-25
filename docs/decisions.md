# Decisions log

Decisions made during the build. The brief is in `docs/handoff/`; where the addendum and the build prompt disagree, the addendum wins.

## From the setup interview (2026-10-25)

| #   | Decision                                                                                                                                  | Why                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Repo `Spr0/LeanCoffee` is public.                                                                                                         | Security rests on RLS and secrets kept out of the repo; unlimited Actions minutes; branch protection available on the free plan. |
| D2  | One Supabase project (`dzvfedktsxomnzokeqap`); no test project.                                                                           | Free-plan slot limit. pgTAP runs in CI on a throwaway local stack; destructive tests hit production only before launch.          |
| D3  | No Turnstile.                                                                                                                             | Keeps the page first-party only; low volume; residual risk documented in `SECURITY.md`.                                          |
| D4  | Netlify site `leancoffee-app` on the personal team.                                                                                       | `leancoffee` was taken.                                                                                                          |
| D5  | Board code is 8 characters.                                                                                                               | Build prompt overrides spec F01 (6).                                                                                             |
| D6  | Vote visibility keys off `boards.votes_revealed_at` (and `extend_rounds.closed_at`), not phase.                                           | Tie-breaks happen after reveal but inside the Vote phase.                                                                        |
| D7  | "Everyone finished" counts participants seen within 45 s via a `heartbeat()` RPC every 20 s.                                              | The database enforces reveal, so presence must live in the database.                                                             |
| D8  | Spec functions F20, F21, F26 topic lock, parking-lot topics, chime with mute, and auto-start-next are in scope. QR code (F05) is backlog. | Build prompt section 5 says follow the spec; QR is for in-person tables.                                                         |
| D9  | Retention is 7 days everywhere.                                                                                                           | Revision 1.1.                                                                                                                    |
| D10 | Plus Jakarta Sans everywhere, including Main, PhoneVote and StageB mockups that load older fonts.                                         | Design tokens win on typography.                                                                                                 |

## Phase 0 (2026-10-25)

| #   | Decision                                                                                                               | Why                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D11 | React 19 instead of React 18.                                                                                          | React 19 is the current stable line and the Vite template default; 18 receives only critical fixes. No dependency in the plan requires 18. |
| D12 | Supabase **publishable key** (`sb_publishable_...`) as `VITE_SUPABASE_PUBLISHABLE_KEY` instead of the legacy anon JWT. | Supabase recommends it for new apps; it rotates independently of the JWT secret. Same public-by-design role.                               |
| D13 | ESLint 9 (not 10).                                                                                                     | `eslint-plugin-jsx-a11y` does not yet support ESLint 10.                                                                                   |
| D14 | `playwright-core` pinned to 1.63.0 via `overrides`.                                                                    | Matches the preinstalled browser and keeps `@axe-core/playwright` types aligned with `@playwright/test`.                                   |
| D15 | gitleaks installed in CI from the release tarball with a SHA-256 check, not the gitleaks Action.                       | No third-party action with repo access; same scanner.                                                                                      |
| D16 | GitHub Actions pinned to commit SHAs.                                                                                  | Supply-chain hardening; Dependabot keeps them current.                                                                                     |
| D17 | Local Supabase config enables anonymous sign-ins.                                                                      | CI database tests need them; production was enabled in the dashboard.                                                                      |
