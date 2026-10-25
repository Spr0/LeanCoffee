# Claude Code build prompt: Lean Coffee app

**Owner:** Scott Henderson
**Date:** 2026-10-24
**Reads with:** `lean-coffee-functional-spec.md` (revision 1.1) and `design/` (12 HTML mockups plus this prompt's design tokens)

You are building and deploying a small, secure, realtime web app. Work in the phases below, run every test gate before moving on, and stop only at the checkpoints marked **ASK SCOTT**. Use a task list and keep it current.

---

## 0. Mission in one paragraph

Build a free **Lean Coffee** meeting app that hosts a live session and hands the results back as files that open cleanly in Windows (Word and Excel). It is used by Scott's own team and peers, 3 to 12 people per session, on Microsoft Teams: the facilitator shares their screen and everyone else has the app open in a browser tab. There are no accounts. People join with a private link and a display name. Security matters more than features: a stranger who does not hold the link must not be able to read or change anything.

## 1. Decisions already made (do not reopen)

| Area | Decision |
|---|---|
| Audience | Scott's own team and peers. Low volume. Not a public product. |
| Setting | Teams call, facilitator shares screen, everyone has a browser tab. Laptop first. Phone is a supported fallback, not the design target. |
| Group size | 3 to 12. Soft warning at 10, hard cap 12. |
| Facilitation | One facilitator at a time, **handover on demand** to any participant. |
| Login | **Name plus private link.** No account, no email. Optional passcode set by the facilitator. |
| Names | Always visible on topics, actions, and take-aways. No anonymous mode. |
| Votes | Dot votes and extend votes are **hidden until everyone has finished** (enforced by the database, not only the UI). |
| Results | **Word (.docx) and Excel (.xlsx)** downloads. No Markdown, no PDF, no print view. |
| Retention | Session data deleted **7 days after the session ends** (or 7 days after last activity if it never formally ends). |
| Theme | Light by default, manual dark toggle, remembered per browser. |
| Out of scope | Accounts, saved history, payments, integrations, AI features, async sessions, simultaneous co-facilitators, hardening for high-stakes executive hybrid meetings (reconnect and resync must work, but no failover design). |

## 2. Stack

- **Frontend:** Vite, React 18, TypeScript (strict), Tailwind CSS. Self-host fonts with `@fontsource/plus-jakarta-sans` (weights 500, 700, 800). Do not load fonts or scripts from third-party CDNs.
- **Backend:** Supabase (Postgres, Realtime, Auth with anonymous sign-ins). All writes go through `SECURITY DEFINER` Postgres functions (RPCs). No custom server.
- **Hosting:** Netlify (static site plus one scheduled function), continuous deploy from GitHub.
- **Export:** `docx` and `exceljs` (both MIT), generated client-side, lazy-loaded so the first page load stays small.
- **Tests:** Vitest and React Testing Library (unit and component), pgTAP via `supabase test db` (database and RLS), Playwright (end to end, multi-user), axe-core (accessibility).
- **Package manager:** npm with a committed lockfile. Pin Node via `.nvmrc`.

## 3. Design reference

The mockups are static HTML with inline styles in `design/`. Open them in a browser at 1440 x 900 (`JoinPhone` and `PhoneVote` at 390 x 844). They are the visual source of truth. If a mockup and this prompt disagree, this prompt wins on behavior and the mockup wins on appearance.

| Mockup file | Screen | Notes |
|---|---|---|
| `HomeCreate.dc.html` | Home: create a board or enter a code | Utility page, no marketing. Remove the "How it works" header link if it adds nothing. |
| `JoinPhone.dc.html` | Join with a display name | Also the desktop join page, centered, same content. |
| `Lobby.dc.html` | Facilitator lobby and session rules | Anonymous switch is replaced by "Require a passcode". |
| `Brainstorm.dc.html` | Phase 1 | Others' topics hidden. |
| `Clarify.dc.html` | Phase 2 | Pitch timer is soft; merge. |
| `PhasesC.dc.html` | Phase 3 Vote (facilitator panel) | Counts hidden until all finish. |
| `DiscussLight.dc.html` | Phase 4 Stage view | Primary screen shared in Teams. |
| `StageB.dc.html` | Dark theme reference plus extend vote | Tally is hidden (shows "?"). |
| `Main.dc.html` | Board tab (kanban overview) | Reached from the Stage/Board toggle. Needs dark and light. |
| `PhoneVote.dc.html` | Phone extend vote | Fallback layout. |
| `WrapUp.dc.html` | Phase 5 take-aways and downloads | Word and Excel cards. |
| `Handover.dc.html` | Pass the facilitator role dialog | Immediate effect. |

### Design tokens

- Font: Plus Jakarta Sans 500 / 700 / 800.
- Light: ink `#1E2A28`, muted `#55625F`, teal `#0F766E`, teal-soft `#D9F0EC`, surface `#F3F5F4`, borders `#D5DDDB` `#E1E7E5` `#C9D3D0` `#8A9894` `#AAB8B4`, urgency orange `#C2410C`, avatar pastels `#FFD9E0` `#CFE6FF` `#D5F2D0` `#FFF1A8` `#E4DBFF` `#FFD9B8`.
- Dark (from `StageB`): ground `#12151B`, panel `#1A1F28`, border `#2B3340`, text `#EEF0F4`, muted `#A4ADBB`, amber `#F5B544`, green `#5BD39B`, red `#FF8A7A`. Derive the remaining dark values so every text pair meets WCAG AA.
- Minimum touch target 44 px. Icons are inline stroke SVG. Common header (64 px) and phase stepper (88 px) on all session screens.

### Teams screen-share legibility (hard requirement for the Stage view)

Teams compresses shared screens, so text and state changes must survive low fidelity.

- Topic title 44 px or larger, timer 64 px or larger, buttons 15 px or larger, no text under 13 px anywhere.
- The timer ring changes to orange at 1:00 **and** shows a text label "1 min left". Never rely on color alone.
- No hairline (1 px) strokes carrying meaning; use 2 px or heavier for ring, selection, and focus.
- No decorative animation. Respect `prefers-reduced-motion`.
- Verify by screenshotting the Stage view at 1920 x 1080 and 1280 x 720 and reading both.

## 4. Security requirements (treat as acceptance criteria)

### 4.1 Threat model

Assets: meeting topics, votes, actions, take-aways, display names. Attackers: someone who guesses or scans for a board, someone who obtained a forwarded link, a participant trying to see hidden votes or act as facilitator, and automated abuse of the anonymous endpoints. Not in scope: nation-state attackers, compromise of Scott's accounts, availability under attack.

### 4.2 Identity and access

1. Use **Supabase anonymous sign-ins** so every browser gets a real JWT and a stable `auth.uid()`. Docs: [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).
2. Anonymous users use the `authenticated` role and carry an `is_anonymous` claim, so **authorize by membership rows keyed to `auth.uid()`, never by role** ([same doc](https://supabase.com/docs/guides/auth/auth-anonymous)). Add a restrictive policy that checks the claim only where you intend to exclude anonymous users.
3. Enable the Supabase IP rate limit for anonymous sign-ins (default 30 per hour per IP, adjustable). Supabase strongly recommends invisible CAPTCHA or Cloudflare Turnstile for this endpoint. **ASK SCOTT** whether to create a free Turnstile site key; if yes, wire it in with the invisible mode so there is no extra step for users. If no, document the residual risk in `SECURITY.md`.
4. Anonymous users are stored in the database and Supabase does not clean them up automatically ([same doc](https://supabase.com/docs/guides/auth/auth-anonymous)). The purge job (4.6) must also delete anonymous `auth.users` older than 14 days that own no live board membership.

### 4.3 Board access and joining

- The invite link carries the credential. Generate the board code with `gen_random_bytes` (never `random()`), 8 characters from an unambiguous 32-character alphabet (about 40 bits), displayed in groups of four such as `KQ74-M2X9`. The mockups show a shorter placeholder; use 8.
- **No anonymous or authenticated user may `SELECT` from `boards` directly.** Lookup and join happen only through RPCs (`lookup_board`, `join_board`) that return the minimum (board name, whether a passcode is required, participant count).
- Throttle failed lookups and failed passcode attempts inside the RPC (counter table keyed by `auth.uid()` with exponential lockout, plus a global ceiling). Return identical responses for "no such board" and "locked" to prevent enumeration.
- Optional passcode: stored hashed with `pgcrypto` `crypt(..., gen_salt('bf'))`, compared in constant time inside the RPC.
- Participant limit enforced in `join_board` (hard cap 12). Display names are 1 to 24 characters, trimmed, unique per board (add a suffix on collision), and treated as untrusted text everywhere.
- The facilitator can lock the board to new joiners and remove a participant. Removal deletes their membership row, so RLS immediately cuts their reads.

### 4.4 Facilitator authority

- Authority is `boards.facilitator_user_id`. Every control RPC verifies `auth.uid() = facilitator_user_id` server-side.
- `pass_facilitator(board, to_user)` transfers it immediately to a current participant.
- The creator also holds a **recovery token** (32 random bytes, base64url) shown once as the "recovery link". Store only its SHA-256 hash. `reclaim_facilitator(board, token)` restores control. The board creator (`owner_user_id`) can also reclaim from the people list without the token while they are still signed in. The mockup copy "You can take it back" means exactly this.
- Never trust a role flag sent by the client.

### 4.5 Hidden votes and hidden topics enforced by RLS

- `topics`: during Brainstorm a user may `SELECT` only rows where `author_user_id = auth.uid()`. From Clarify on, all members may read all topics.
- `votes` (dots): a user may read only their own rows until the board phase is Discuss or later. Totals come from a `SECURITY DEFINER` function or view that returns nothing before reveal.
- `extend_votes`: same rule, per extend round, until the round closes.
- No write path allows more than N dots per user per board, voting on your own topic when that rule is off, or voting outside the Vote phase. Enforce in the RPC and in constraints.
- Add pgTAP tests for each rule (see 7.2).

### 4.6 Data protection and retention

- Row-Level Security **enabled with no permissive default** on every table in `public`. Deny by default; add narrow policies.
- Every `SECURITY DEFINER` function sets `search_path = ''` and schema-qualifies all names. Revoke `EXECUTE` from `public` and grant it only to `authenticated`.
- Column constraints: topic text 1 to 160 characters, action text 1 to 140, take-away 1 to 200, board name 0 to 60, plus per-board row ceilings (topics 5 per person, actions 60, take-aways 1 per person).
- Retention: `purge_after = coalesce(ended_at, last_activity_at) + interval '7 days'`. A daily `pg_cron` job deletes expired boards with cascading deletes and writes no log of content. Confirm `pg_cron` is available on the project; if not, run the purge from the Netlify scheduled function described in 6.4. See [Supabase pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) [Verify This].
- Never put the `service_role` key in the repo, the browser bundle, or Netlify client env. The browser uses only the project URL and anon key (public by design). Any privileged job runs from a GitHub Actions secret or a Netlify server-side env var.

### 4.7 Realtime

- Use Realtime with RLS so non-members receive nothing. For Broadcast and Presence, use **private channels** (`channel(name, { config: { private: true } })`), disable "Allow public access" in Realtime settings, and write policies on `realtime.messages` that allow only board members to join the topic `board:<id>`. Docs: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization).
- Policies are cached for the life of a connection ([same doc](https://supabase.com/docs/guides/realtime/authorization)). When a participant is removed, force a token refresh or channel rejoin for that user and test that they stop receiving events.
- Table state flows through Postgres Changes, which applies RLS. Add a test that a non-member client subscribed to the same board topic receives zero events.

### 4.8 Web hardening (Netlify `_headers` or `netlify.toml`)

- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` (add the Turnstile origin only if enabled). Tighten `style-src` if Tailwind output allows it.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (the URL contains the board code, so it must never leak in a Referer header), `Permissions-Policy` denying camera, microphone, geolocation, `Cross-Origin-Opener-Policy: same-origin`.
- No analytics, no third-party scripts, no tracking cookies. Mark the invite page `noindex` and add `robots.txt` disallowing `/b/`.
- React escaping only. Never use `dangerouslySetInnerHTML`. Add an ESLint rule that fails the build if it appears.
- Supply chain: `npm audit --audit-level=high` in CI, Dependabot or Renovate enabled, `gitleaks` in CI and as a pre-commit hook, lockfile integrity checked.

### 4.9 Export safety

- **Spreadsheet formula injection:** any cell value that begins with `=`, `+`, `-`, `@`, tab, or carriage return gets a leading apostrophe-equivalent (write it as an explicit string cell and prefix a single quote character in the displayed text). Test with `=HYPERLINK(...)` and `=cmd|...` payloads.
- **Filenames:** `{Board name} {YYYY-MM-DD}.docx` and `.xlsx`. Strip or replace the Windows-illegal characters `< > : " / \ | ? *`, control characters, trailing dots and spaces, and reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`). Cap at 100 characters. Fall back to `Lean Coffee {date}`.
- Strip characters not allowed in XML 1.0 from all text before writing either file.

### 4.10 Documentation

Ship `SECURITY.md` covering: threat model, what is stored and for how long, how access works, how to rotate the Supabase anon key and JWT secret, what to do if a link leaks (lock the board, remove people, end the session), and known limits (anyone with the link can join until locked, names are self-asserted).

## 5. Behavior reference

Follow `lean-coffee-functional-spec.md` for phases, timers, and rules, with these overrides from revision 1.1: no anonymous mode, handover instead of a single fixed facilitator, Word and Excel export, 7-day retention, group size 3 to 12.

Key rules to implement exactly:

- Phases: Lobby, Brainstorm (5:00), Clarify (30 s soft pitch), Vote (1:30), Discuss (5:00 plus 3:00 extensions), Wrap-up (5:00 soft).
- 3 dots per person; voting on your own topic off by default; stacking allowed.
- Extend vote: 15 s window, Keep going / Neutral / Move on, extend only if Keep going > Move on, ties and no votes mean move on, tally hidden until all voted or the window closes, facilitator can override.
- Ties after Vote: facilitator drags by default; mini-vote and random are settings.
- Topic cap 5 per person, 160 characters.
- "Topics we can still fit" estimate and the wrap-up prompt at 5 minutes remaining.

### Timers

- Store `phase_ends_at` (timestamptz) or `paused_remaining_ms`. Clients compute the countdown from a server offset obtained at connect (`server_time()` RPC), re-measured every 60 s and on tab visibility change. No per-second database writes.
- Reconnect, refresh, and a backgrounded tab must show the correct time immediately.
- Only phase changes, pauses, adjustments, and extend rounds write to the database.

## 6. Build phases and gates

Do not start a phase until the previous gate is green.

### Phase 0: Repo and tooling
- Create the repo (**ASK SCOTT** for GitHub account or org and repo name; default `lean-coffee`, private). Initialize Vite React TS, Tailwind, ESLint, Prettier, Vitest, Playwright, `.nvmrc`, `.env.example`, `SECURITY.md` stub, `README.md`.
- Install the Supabase CLI. **ASK SCOTT** to create the Supabase project (free tier) and provide the project URL, anon key, and a personal access token, or to run `supabase login` and `supabase link` interactively. Never commit them.
- GitHub Actions CI skeleton: install, lint, typecheck, unit tests, build, `npm audit`, `gitleaks`.
- **Gate 0:** CI green on an empty app.

### Phase 1: Database, RLS, RPCs
- Write migrations for the data model in section 8, all RPCs, RLS policies, realtime policies, constraints, the purge job, and `keepalive()`.
- Write the pgTAP suite (7.2) alongside. Run with `supabase db reset && supabase test db`. If Docker is unavailable in your environment, say so, run the tests against a throwaway hosted Supabase branch or project instead, and note it in the README.
- **Gate 1:** all RLS, hidden-vote, facilitator-authority, throttle, cap, and retention tests pass.

### Phase 2: Core client and realtime
- Auth bootstrap, home, join, lobby, presence, settings, Stage/Board toggle shell, theme toggle, error and reconnect states.
- **Gate 2:** unit and component tests pass; two-browser Playwright smoke (create, join, see each other).

### Phase 3: Session phases
- Brainstorm, Clarify (pitch timer, merge and undo), Vote (reveal, ties), Discuss (stage view, timer, extend vote, next topic, actions, reorder), Wrap-up, handover, remove participant, lock, end session.
- Match the mockups. Apply the Teams legibility rules to the Stage view.
- **Gate 3:** full-session Playwright run with 6 browser contexts passes (7.3).

### Phase 4: Export
- Word and Excel builders, download buttons, filename sanitizing, formula-injection guard (section 9).
- **Gate 4:** export unit tests, round-trip parse tests, and LibreOffice conversion check pass.

### Phase 5: Hardening and accessibility
- Headers, CSP, no-referrer, dependency audit clean, axe checks, keyboard-only run-through, reduced motion, screen-reader announcements for timer at 1:00, 0:30, 0:00 only.
- **Gate 5:** security test suite (7.5) and accessibility suite pass; Lighthouse accessibility 95 or higher on every session screen.

### Phase 6: Deploy
1. **ASK SCOTT** to run `netlify login` (or provide a token) and confirm the site name.
2. Create the Netlify site linked to the GitHub repo. Build command `npm run build`, publish directory `dist`, Node version from `.nvmrc`.
3. Set environment variables in Netlify (not in the repo): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_TURNSTILE_SITE_KEY`.
4. `netlify.toml`: SPA fallback (`/*` to `/index.html`, status 200), the headers from 4.8, and the keep-alive scheduled function.
5. Deploy a **preview** first. Run the Playwright suite against the preview URL. Only then merge to `main` for production.
6. GitHub branch protection on `main`: require CI green and one passing check before merge.
7. **Gate 6:** production smoke test (create board, join from a second browser, run one topic, download both files) passes, and the keep-alive has run once successfully.

### 6.4 Keep the free database awake

Supabase pauses free projects after 7 days of low activity; typically a few user requests per day over the previous week is enough to avoid it ([Project pausing](https://supabase.com/docs/guides/platform/project-pausing)). Low-volume use makes this a real risk, so it is a required deliverable:

- Create `keepalive()` (callable by `anon`/`authenticated`, does a trivial read and writes nothing sensitive).
- Netlify scheduled function running daily (`@daily`). Scheduled functions are available on all plans, run only for published production deploys, are evaluated in UTC, and have a 30 second limit ([Netlify docs](https://docs.netlify.com/build/functions/scheduled-functions/)).
- Backup: a GitHub Actions workflow on a daily cron that calls the same RPC. Note GitHub can disable scheduled workflows in repos with no recent activity, which is why there are two.
- Test: invoke both once, confirm the call lands in the Supabase logs.
- Document in the README how to resume a paused project (Dashboard, Resume project; restorable within one year per the same pausing doc).

## 7. Testing (extensive, and required before deploy)

### 7.1 Unit and component (Vitest, RTL)
- Timer math: countdown from end timestamp, pause and resume, adjust, clock-skew offsets of -5 s, +5 s, and +60 s, backgrounded-tab resync (fake timers).
- Extend-vote rule table: every combination of Keep going / Neutral / Move on counts including no votes and ties.
- Tie-break logic, dot allocation limits, merge and unmerge, topic cap, "topics we can still fit" estimate.
- Components: each phase screen renders each state; buttons visible only to the facilitator; handover dialog; hidden counts show "?" and never leak numbers into the DOM before reveal.
- Display name validation, text length limits, unicode and emoji handling.

### 7.2 Database and RLS (pgTAP)
Build a role matrix and assert each row:

| Actor | Brainstorm: read others' topics | Read others' dots before reveal | Read totals before reveal | Call facilitator RPCs | Read board directly | Receive realtime for the board |
|---|---|---|---|---|---|---|
| Facilitator | no (own only) | no (own only) | no | yes | no | yes |
| Participant | no | no | no | no | no | yes |
| Removed participant | no | no | no | no | no | no after refresh |
| Non-member | no | no | no | no | no | no |
| Signed-out | no | no | no | no | no | no |

Also test: join cap at 12, name collision suffix, passcode lockout, enumeration returns identical responses, dot over-allocation rejected, own-topic vote rejected when off, phase-order enforcement, handover and reclaim (token and owner paths), reclaim with a wrong token fails, purge deletes exactly the expired boards and their children, `SECURITY DEFINER` functions have `search_path` set (query `pg_proc` and fail if any lack it), RLS enabled on every `public` table (query `pg_class` and fail otherwise).

### 7.3 End to end (Playwright, multiple contexts)
- Happy path: 1 facilitator + 5 participants, full six-phase session, 9 topics, two extensions, a handover mid-session, downloads at the end.
- Hidden-value tests: inspect the DOM, network frames, and websocket payloads for participants and assert no vote counts or others' topics appear before reveal.
- Resilience: reload a participant mid-vote, drop and restore network (`context.setOffline`), close and reopen the facilitator tab, facilitator disconnect with handover, join mid-session, 12-person join and the 13th rejected.
- Timer fidelity: two contexts, one with a skewed clock (Playwright clock control), assert displayed times stay within 1 s of each other.
- Visual checks: screenshots of every screen at 1440 x 900, 1920 x 1080, 1280 x 720, and a 960-wide half-screen window; review each against its mockup and list deviations in the PR.

### 7.4 Accessibility
- axe-core on every screen in light and dark. Keyboard-only completion of a session. Focus management in the handover dialog. Contrast AA for every text pair. Screen-reader labels for the ring timer and vote controls.

### 7.5 Security tests
- XSS strings in names, topics, actions, take-aways, board name (`<img src=x onerror=...>`, `"><script>`, very long strings, RTL override, zero-width characters). Assert escaped everywhere, including exports.
- Export injection: topic text `=HYPERLINK("http://example.com","x")`, `+1+1`, `@SUM(1+1)`, `-2+3`. Assert the xlsx cell is a literal string and Excel-safe.
- CSP and headers: fetch the deployed page and assert every header in 4.8. Assert no request leaves for any origin other than self and Supabase. Assert the Referer header is empty on outbound navigations.
- Direct API probing with the anon key: attempt `select` on every table, `rpc` on every function as a non-member, as a removed member, and as signed-out. Everything except the intentionally public RPCs must fail.
- Secret scan: build output and git history contain no `service_role` key.
- Load smoke: 12 concurrent clients through one full session, no errors, no message-rate warnings.

### 7.6 Export fidelity
See section 9. Include a LibreOffice headless conversion step in CI as a proxy for Word and Excel compatibility. State clearly in the README that real Word and Excel were not available in CI and that Scott should open one sample of each before relying on them.

## 8. Data model (guideline; improve if you find better, keep the rules)

`boards` (id, code, name, owner_user_id, facilitator_user_id, recovery_hash, passcode_hash, settings jsonb, phase, planned_minutes, phase_ends_at, paused_remaining_ms, current_topic_id, locked, created_at, started_at, ended_at, last_activity_at, purge_after)
`participants` (board_id, user_id, display_name, joined_at, last_seen_at, finished_voting)
`topics` (id, board_id, author_user_id, text, status, merged_into, sort_order, time_spent_ms, extensions)
`votes` (board_id, topic_id, user_id, dots) with a unique key and a constraint on total dots per user
`extend_rounds` (id, board_id, topic_id, opened_at, closes_at, result)
`extend_votes` (round_id, user_id, choice)
`actions` (id, board_id, topic_id, text, owner_name, created_by, done)
`takeaways` (board_id, user_id, text, passed)
`join_attempts` (user_id, window_start, failures) for throttling

RPCs (all `SECURITY DEFINER`, `search_path = ''`): `create_board`, `lookup_board`, `join_board`, `update_settings`, `start_phase`, `timer_pause`, `timer_resume`, `timer_adjust`, `add_topic`, `edit_topic`, `delete_topic`, `merge_topics`, `unmerge_topic`, `cast_dots`, `finish_voting`, `reveal_votes` (internal), `reorder_topics`, `start_discussion`, `open_extend_round`, `cast_extend_vote`, `resolve_extend_round`, `next_topic`, `add_action`, `toggle_action`, `set_takeaway`, `pass_facilitator`, `reclaim_facilitator`, `remove_participant`, `lock_board`, `end_session`, `server_time`, `keepalive`, `purge_expired`.

## 9. Export specification (Windows friendly)

Both files are generated in the browser from the final board state and are available to everyone in the session.

**Word (.docx)**, US Letter, 1 inch margins, Calibri 11 pt body:
1. Title: board name. Subtitle line: `Lean Coffee, {long date}, {n} people, {minutes} min`.
2. **Discussed**: numbered list in discussion order, each with author, votes, time spent (`m:ss`), and number of extensions.
3. **Actions**: a table (Action, Owner, Topic) with a header row, borders, and repeated header across pages.
4. **Take-aways**: one line per person, `Name: text`; passes omitted.
5. **Not discussed**: remaining topics with votes.
Use real Word heading styles (Heading 1 and 2), a real table, and document properties (title, creator "Lean Coffee").

**Excel (.xlsx)**, three sheets:
1. `Topics`: Rank, Topic, Author, Votes, Status, Time spent, Extensions.
2. `Actions`: #, Action, Owner, Topic.
3. `Take-aways`: Name, Take-away.
Bold frozen header row, autofilter, wrapped text, column widths set to content (cap 60), numeric columns stored as numbers, time stored as an Excel time value with `mm:ss` format. UTF-8 safe. Apply the injection guard from 4.9 to every text cell.

## 10. Definition of done

- Every gate green, in CI and against the Netlify preview.
- Production site live on Netlify from GitHub `main`, headers verified, keep-alive verified.
- `README.md`: purpose, architecture, local setup, environment variables, test commands, deploy, recovery of a paused project, export caveat.
- `SECURITY.md` complete.
- A short **handoff report** to Scott containing: what was built, a table of every gate with pass or fail and the command that proves it, mockup deviations, anything not tested (state it plainly), residual risks, and the three things Scott should do manually (open one sample `.docx` and `.xlsx` in real Word and Excel, run a trial session with two people over Teams, save the recovery link).

## 11. Working agreements

- Ask Scott only at the **ASK SCOTT** points. Otherwise decide, record the decision in `docs/decisions.md`, and continue.
- Do not weaken a security requirement to make a test pass. If a requirement cannot be met on the free tier, stop, explain, and propose the nearest alternative.
- Do not claim a test passed without running it. Report failures and fixes honestly.
- Commit in small steps with clear messages. Never commit secrets or `.env` files.
- Keep the scope to this prompt. Anything tempting but unlisted goes in `docs/backlog.md`.

## Sources

- [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase project pausing](https://supabase.com/docs/guides/platform/project-pausing)
- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/)
