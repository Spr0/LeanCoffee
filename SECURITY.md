# Security

Lean Coffee is a small meeting tool for a known group of people. It has no accounts: people join with a private link and a display name. This page explains what that protects, what it does not, and what to do when something goes wrong.

## Reporting a problem

Contact the owner directly. Do not open a public GitHub issue for a vulnerability.

## Threat model

**Protected:** meeting topics, dot votes, extend votes, actions, take-aways and display names.

**Attackers considered**

| Attacker                                        | What stops them                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone guessing or scanning for boards         | 8-character codes from a 32-character alphabet (about 40 bits, from `gen_random_bytes`). Failed lookups lock a browser out with growing delays (5 failures in 15 minutes); a global ceiling applies to anyone already failing. "No such board" and "locked out" return identical responses. |
| Someone holding a forwarded link                | Optional passcode (bcrypt, at least 6 characters, capped at 20 wrong guesses per board per hour across all identities). The facilitator can lock the board and remove people.                                                                                                               |
| A participant trying to see hidden things early | Enforced in the database, not the page: others' Brainstorm topics, other people's dots before reveal, and extend-vote choices before the round closes are invisible to Row-Level Security. Totals are computed server-side only after reveal.                                               |
| A participant trying to act as facilitator      | Every control checks `facilitator_user_id` in the database. The page never sends a role flag.                                                                                                                                                                                               |
| A removed participant                           | Removal deletes their membership row, which cuts every read and live update immediately (tested). Their identity cannot rejoin.                                                                                                                                                             |
| Automated abuse of anonymous sign-in            | Supabase's per-IP limit on anonymous sign-ins (30 per hour by default). No CAPTCHA: see Known limits.                                                                                                                                                                                       |
| Script injection                                | React escapes all text; `dangerouslySetInnerHTML` and `innerHTML` fail the build. A strict Content Security Policy allows scripts only from the app itself. Exports guard against spreadsheet formula injection.                                                                            |

**Out of scope:** nation-state attackers, compromise of the owner's GitHub, Netlify or Supabase accounts, and availability under deliberate attack.

## What is stored, and for how long

| Data                                                           | Where                                                        | Kept until                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Board name, settings, phase and timers                         | Supabase `board_state`                                       | 7 days after the session ends, or 7 days after the last activity if it never formally ends |
| Room code, passcode hash, recovery-link hash, removed users    | Supabase `boards` (never readable by anyone through the API) | Same as above                                                                              |
| Display names, topics, dots, extend votes, actions, take-aways | Supabase, one table each                                     | Same as above (deleted with the board)                                                     |
| Failed lookup and passcode attempts (identity and time only)   | Supabase `failed_attempts`                                   | 1 day                                                                                      |
| Anonymous sign-in identities                                   | Supabase Auth                                                | Deleted after 14 days if they no longer belong to any live board                           |
| Theme, sound setting, the creator's recovery link              | The person's own browser (localStorage)                      | Until they clear their browser data                                                        |

A daily job at 03:17 UTC (`pg_cron`, `private.purge_expired`) does the deleting. It records counts only, never content. There are no analytics, tracking cookies or third-party scripts.

## How access works

1. Every browser signs in to Supabase anonymously and gets its own identity (a signed token).
2. Joining a board with the link (and passcode, if set) creates a membership row for that identity.
3. Row-Level Security lets each identity read only boards it is a member of, and nothing at all in `boards` or `failed_attempts`. There are no write permissions on any table: every change goes through a database function that checks membership and, for controls, the facilitator role.
4. Live updates use Supabase Realtime with the same Row-Level Security, on private per-board channels. Clients can receive but never publish.
5. The board creator gets a one-time recovery link (`/b/<code>#recover=<token>`). The token sits after `#`, so browsers never send it to any server; only its SHA-256 hash is stored.

## Web protections

Every page is served with: a Content Security Policy (`default-src 'self'`, scripts only from the app, network calls only to the app and its Supabase project, no framing), HSTS, `nosniff`, `Referrer-Policy: no-referrer` (board links never leak to other sites), a Permissions-Policy denying camera, microphone and location, and `Cross-Origin-Opener-Policy: same-origin`. Invite pages are sent with `X-Robots-Tag: noindex`; `robots.txt` deliberately allows crawling, because a crawler blocked from a page never sees its `noindex`. The headers are generated at build time by `security-headers.ts` (the build fails without them), the local preview server sends the same headers so every end-to-end test runs under the real policy, and the header test is re-run against the live site after each deployment.

## If a link leaks

1. **Lock the board** (Manage people, then Lock the board). Nobody new can join; people already in stay.
2. **Remove anyone who should not be there** (Manage people, Remove).
3. If the session is over, **end it**. The board becomes read-only and is deleted 7 days later.
4. If it matters, start a new board and share the new link only with the people who need it.

## If the recovery link leaks

The recovery link only works for someone who has joined the board, and it keeps working (it is not changed when used). If it leaks to someone already in the board, they can take the facilitator role. The board creator can take it back from the sidebar at any time without the link; then **remove that person** (which blocks their identity) and **lock the board** (which stops them rejoining under a new identity).

## Rotating keys

The app uses only the Supabase **publishable key**, which is public by design (it is in every visitor's browser). The admin (`service_role` / secret) key is never used by the app, never stored in the repo or in Netlify, and CI fails if one appears in the build.

- **Publishable key:** in the Supabase dashboard, open Project Settings, API Keys. Create a new publishable key, update `VITE_SUPABASE_PUBLISHABLE_KEY` in Netlify (Site configuration, Environment variables), trigger a deploy, then disable the old key.
- **JWT signing keys:** in the Supabase dashboard, open Project Settings, JWT Keys, and rotate. Everyone is signed out and gets a new anonymous identity on their next visit, which means they must rejoin any board in progress (their old identity's membership no longer matches).

## Known limits and residual risks

- **Anyone with the link can join until the board is locked.** Names are self-chosen and not verified.
- **Removal is per identity.** A removed person can open the link in a fresh browser and join under a new name unless the board is locked. Lock after removing.
- **No CAPTCHA on anonymous sign-in.** Turnstile was declined to keep the page free of third-party scripts. The Supabase per-IP limit is the only brake on scripted sign-ins.
- **Flooding failed lookups** can slow down an attacker's own requests and anyone else who is also failing, but not people entering valid codes.
- **One Supabase project, no staging database.** Every migration is proven against a throwaway database in CI first; production changes are applied by hand in the SQL Editor. Supabase branching (paid) is the upgrade path.
- **Live updates rely on Supabase Realtime applying Row-Level Security.** Tested: outsiders (on private or public channels) and removed members receive no inserts or updates. Supabase does not filter **delete** events by Row-Level Security: any signed-in visitor listening to a table can see that a row with a random id was deleted, and when. They never see content (tested), and every table uses a random id as its key so nothing about people or votes can be inferred. **Allow public access** is off in the Supabase Realtime settings, so only private, member-checked channels work (checked against production on 2026-10-25: a public channel is refused with `PrivateOnly`). Keep it off.
- **The recovery link is not rotated** after use. See "If the recovery link leaks".
- **The free Supabase project pauses after a week of no activity.** A daily keep-alive (a Netlify scheduled function, with a GitHub Actions backup) is set up at deployment; the README explains how to resume a paused project.

## Controls checked in CI on every push

- ESLint bans `dangerouslySetInnerHTML` and `innerHTML`.
- `npm audit --audit-level=high` (currently 0 vulnerabilities of any level) and a full-history gitleaks scan.
- A privileged-key check (`scripts/check-dist-keys.mjs`) that also decodes JWT-style keys, because their role is not visible as plain text. It runs in CI against a canary to prove it can fail, and on Netlify against the real production bundle.
- 115 database assertions (pgTAP): access matrix, hidden values, facilitator authority, throttling, caps, retention, and structural checks (RLS on every table, `search_path` pinned on every privileged function, minimal grants).
- End-to-end: exact CSP and header checks, script-like input in every field, no requests or websockets to other origins, no Referer to Supabase, direct API probing as an outsider, a removed member and a signed-out visitor, realtime isolation, and a 12-person load run.
- GitHub Actions pinned to commit SHAs, checkouts do not keep credentials, and every tool CI installs is version-locked (Lighthouse has its own lockfile in `tools/lighthouse`); Dependabot for npm and Actions; gitleaks pre-commit hook.
