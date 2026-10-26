# Handoff report: Lean Coffee

Date: 2026-10-25, updated 2026-10-26 for the board on every phase and the wave 1 fixes. Live at https://leancoffee-app.netlify.app (Netlify, deployed from `main` of `Spr0/LeanCoffee`). Database: Supabase project `dzvfedktsxomnzokeqap` (free tier).

## What was built

A free, anonymous, realtime Lean Coffee app for 3 to 12 people on a call:

- **Start and join:** no accounts. The facilitator names the session and gets a room code, an invite link and a private recovery link. Others join with the link or the code and a display name; an optional passcode, a lock and removal control who gets in. After the Lobby an Invite button in the header copies the link or a ready-to-send invite message.
- **Six phases with one server clock:** Lobby (timers and rules), Brainstorm (topics hidden from others; the clock starts when the facilitator is ready), Clarify (merge duplicates, optional timed pitches or Skip pitches, a suggested dot count), Vote (hidden dots until everyone is done, tie handling), Discuss (the board: To discuss, the stage with a large ring timer, and Discussed with each topic's actions; group extend vote that moves on by itself, parking lot, skip with Bring back), Wrap-up (take-aways and actions), Ended (read-only).
- **Facilitator tools:** pause, plus or minus a minute, hand over the role, take it back, edit or delete any topic, end the session at any point, and a reconnecting notice for everyone if the facilitator drops.
- **Results:** Word and Excel downloads built in the browser, from the revealed vote onward, in the Pine colors, with a key-facts strip, banded tables and page numbers.
- **Security:** every rule is enforced in the database (Row-Level Security and checked functions), live updates on private member-only channels, strict Content Security Policy and headers, data deleted 7 days after a session, no third-party scripts. Details in [`SECURITY.md`](../SECURITY.md).
- **Operations:** daily keep-alive (Netlify scheduled function plus a GitHub Actions backup), a daily live header check, branch protection on `main`.

## Gates

| Gate                          | Result | Evidence                                                                                                                                                                                                                                | Command that proves it                                                                                                                                            |
| ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Repo and tooling            | Pass   | [CI 40159127493](https://github.com/Spr0/LeanCoffee/actions/runs/40159127493)                                                                                                                                                           | `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`                                                                          |
| 1 Database, RLS, functions    | Pass   | [CI 40161071337](https://github.com/Spr0/LeanCoffee/actions/runs/40161071337); now 137 pgTAP assertions                                                                                                                                 | `npx supabase start && npx supabase db reset && npx supabase test db`                                                                                             |
| 2 Core client and realtime    | Pass   | [CI 40170418600](https://github.com/Spr0/LeanCoffee/actions/runs/40170418600)                                                                                                                                                           | `npx playwright test e2e/two-browsers.spec.ts e2e/realtime-isolation.spec.ts`                                                                                     |
| 3 Session phases              | Pass   | [CI 40190087572](https://github.com/Spr0/LeanCoffee/actions/runs/40190087572)                                                                                                                                                           | `npx playwright test e2e/full-session.spec.ts e2e/visual.spec.ts`                                                                                                 |
| 4 Export                      | Pass   | [CI 40194387985](https://github.com/Spr0/LeanCoffee/actions/runs/40194387985)                                                                                                                                                           | `EXPORT_SAMPLES=$PWD/test-results/exports npx vitest run src/lib/export` (needs LibreOffice)                                                                      |
| 5 Hardening and accessibility | Pass   | [CI 40198182297](https://github.com/Spr0/LeanCoffee/actions/runs/40198182297); Lighthouse 100 on all 22 screens                                                                                                                         | `npx playwright test e2e/security.spec.ts e2e/keyboard.spec.ts e2e/load.spec.ts` and `node scripts/lighthouse-a11y.mjs <url> tools/lighthouse`                    |
| 6 Deploy                      | Pass   | Full browser suite against the preview and production; keep-alive verified from Netlify (18:37 UTC) and [GitHub Actions](https://github.com/Spr0/LeanCoffee/actions/runs/40218000441)                                                   | `E2E_BASE_URL=https://leancoffee-app.netlify.app npx playwright test e2e/smoke.spec.ts e2e/two-browsers.spec.ts e2e/security.spec.ts --grep-invert "API probing"` |
| Launch audit fixes            | Pass   | [CI 40233831397](https://github.com/Spr0/LeanCoffee/actions/runs/40233831397) on 34fd398; light browser checks on the preview and on production; first [live header check](https://github.com/Spr0/LeanCoffee/actions/runs/40234760089) | All of the above, plus `e2e/launch-ui-a.spec.ts` and `e2e/launch-ui-b.spec.ts`                                                                                    |

Totals on the shipped commit: 137 database assertions, 142 unit and component tests, 16 browser tests (axe in light and dark on every screen), Lighthouse accessibility 100 on 22 screen and theme pairs.

## Launch audit

After the first production deploy, five independent auditors checked the live site, the live database as an outsider, operations, the documentation and the functional spec; a separate verifier tried to refute each finding. The outsider probe of the live database found nothing (27 checks). The real findings, all fixed and retested:

- **Behavior:** a Move on vote did not move on by itself; an ended board could still be changed through the API; skipped topics could not be brought back; several spec controls were missing (minus a minute, pausing pitch and wrap-up clocks, facilitator edit and delete after Brainstorm, downloads before Wrap-up, free-text action owners, end session at any time, the facilitator reconnecting notice).
- **Operations and docs:** the key-rotation steps would have broken the backup keep-alive; the README said a paused project can be restored for a year (Supabase now says 90 days); stale and overstated statements in `SECURITY.md`; Lighthouse's own dependencies had high advisories; a missing file under `/assets/` returned the app instead of a 404,. Hashed files stay on Netlify's default revalidation, because a year-long cache rule would also stick to that 404.

Your changes during launch are recorded as decisions D63 to D66 and D72 to D74.

## Board on every phase and wave 1 fixes (2026-10-26)

Every phase after the Lobby is now the board you chose (option 3): To discuss on the left, the stage in the middle, Discussed on the right (D75 to D88). Eight testers then worked through it on a preview and two reviewers read the code; their real findings are fixed and recorded as D89 to D102. The ones you would notice:

- **The board no longer contradicts itself.** After Next topic every browser used to show the topic on stage and in a column at once for up to 3.7 s. The board now loads the state with the tables it affects and shows them together, and the stage holds the last consistent board for up to 3 s (D90, D93).
- **A double-click does one thing.** A second press on Next topic used to send a topic nobody saw to Discussed. Presses that lose a race to another tab show no red error (D93, D94). Two facilitator tabs pressing within a second need the new server guard (D95) plus a small client change after it is applied (backlog).
- **Dots stack.** A third dot on one topic was refused while the stage said "1 left" (D89, needs its migration).
- **Recovery.** A dropped connection catches up at once, a failed load retries, and a stuck board reopens and then offers Try again (D91).
- **Accessibility and the Teams share.** Dialogs open on their title and ask before removing someone; drafts and focus survive Next topic; every phase keeps its main controls on a 1280 x 720 share with a 160-character topic; Windows High Contrast keeps the ring and buttons visible; input borders meet 3:1; the tab title names the phase (D93, D96 to D99, D102).
- **Files.** The topic on stage, skipped and partly discussed topics, the board's order, actions grouped under their topic, exact times in Excel and right-to-left text in Word (D100, D101).

**Before deploying,** apply the three new migrations in the order the README lists (`20261026100000`, `20261026110000`, `20261026120000`). The client does not depend on them, but dot stacking stays broken until the first is applied.

**Not covered by this round:** the two-tab double press (above); a removed person who does nothing still waits up to 20 s for the removal screen; the Realtime reconnect after a real 30 s network drop was unit-tested, not repeated in a browser; the request savings per change were counted from the code, not measured; Word's right-to-left layout and High Contrast were checked in generated XML and Chromium's emulation, not in Word or Windows. Five smaller items are in [`docs/backlog.md`](backlog.md).

## Deviations from the mockups

| Mockup           | What differs                                                                                                  | Decision      |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| All              | Plus Jakarta Sans everywhere; Pine green accent instead of the mockups' teal                                  | D10, D72      |
| HomeCreate       | "Name" and "Name this session" fields, 30 to 75 minute lengths, "Enter code" join box, no "How it works" link | D32, D63      |
| Lobby            | No QR code; pitch and wrap-up timer settings added; End session and Copy invite message added                 | D37, D69, D66 |
| Brainstorm       | Topic count instead of who has added topics; the clock starts stopped with a Start button                     | D43, D64      |
| Clarify          | Skip pitches, dots suggestion, edit and delete on cards                                                       | D65, D70      |
| StageB (Discuss) | During an extend vote the ring shrinks beside the vote panel; tie order changes by arrows, not drag           | D42, D44      |
| Header           | Room code with a separate Invite button                                                                       | D66, D74      |

## Not tested (plainly)

- **Real Microsoft Word and Excel.** CI reads the files back and converts them with LibreOffice; nobody has opened them in Office yet.
- **A real Teams call.** Legibility was checked with 1280 x 720 screenshots, not a live screen share.
- **Browsers other than Chromium,** including Safari, Firefox and phones. Mobile layouts were checked at 390 px in Chromium only.
- **Screen readers.** axe, Lighthouse and a keyboard-only session pass; no NVDA, JAWS or VoiceOver session was run.
- **The http to https redirect.** The build container can only make https connections; Netlify enforces https by default.
- **The Netlify keep-alive on its own schedule.** It ran successfully when triggered by hand; its first scheduled run is at 00:00 UTC.
- **A paused-and-resumed Supabase project,** sessions longer than about 10 minutes, and more than 12 people.

## Residual risks

- Anyone with the link can join until the board is locked; names are not verified; there is no CAPTCHA on anonymous sign-in (Turnstile declined).
- The recovery link is not rotated after use, and it cannot reclaim a locked or full board from a new device (both in [`docs/backlog.md`](backlog.md)).
- One Supabase project and no staging database: migrations are proven in CI and then applied by hand in the SQL Editor.
- The free project pauses after a week without traffic if both keep-alives stop; restore within 90 days from the dashboard.
- Supabase does not filter delete events by Row-Level Security: a signed-in visitor can learn that a row with a random id was deleted, never its content.
- The production database holds test boards from the launch runs; the daily purge removes them within 7 days.
- Six Dependabot update pull requests are open (#1 to #6). #6 (Lighthouse 13.5.0) is already applied on `main` and will close itself; the others need a look before merging, as TypeScript 7 and ESLint 10 are major versions.

## Three things for you to do

1. **Open one sample `.docx` and `.xlsx` in real Word and Excel.** Download both from a test session's Wrap-up (or the `export-samples` artifact of the latest CI run) and check they open without repair prompts, look right, and print sensibly.
2. **Run a two-person trial over Teams.** Create a board, share your screen on the Discuss stage, have someone join from the Invite link on another device, run one topic through an extend vote, and download both files.
3. **Save the recovery link** every time you create a real board (Lobby, Copy recovery link). It is the only way to take the facilitator role back from a new browser.
