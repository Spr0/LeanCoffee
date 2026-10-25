# Lean Coffee App: Functional Specification (v1 draft)

**Status:** Revision 1.1, 2026-10-24 (see the revision table before section 1)
**Design direction:** Hybrid. Guided phase stepper (mockup C) as the spine, timer-first stage view (mockup B) for the Discuss phase, kanban overview (mockup A) as a "Board" tab.
**Theme:** Light by default, dark mode toggle.
**Build target (detailed in step 4):** Vite, React, TypeScript, Supabase free tier, Netlify via GitHub.

TL;DR: A free, anonymous, realtime Lean Coffee app. Six phases (Lobby, Brainstorm, Clarify, Vote, Discuss loop, Wrap-up). One shared server-authoritative clock. The group, not the facilitator, decides whether a topic continues. Every timer has a default and is adjustable. Source-backed facts are marked with a Basis line. Design choices that are mine are marked **Decision** so you can overrule them.

---

## Revision 1.1 (2026-10-24): audience and security decisions

This section supersedes any conflicting text below. It comes from the audience interview with Scott.

| Area | Revised decision | Replaces |
|---|---|---|
| Audience and setting | Scott's own team and peers, 3 to 12 people, on a Teams call. Facilitator shares their screen; everyone else has the app open in a browser tab. Laptop first, phone as fallback. | "Phone-first for participants" (principle 5) |
| Facilitation | One facilitator at a time, with **handover on demand** to any participant. The board creator can always reclaim the role, and a one-time recovery link restores it if the browser is lost. | "One facilitator per board... no co-facilitator" (section 2) |
| Login | Name plus private link. Optional passcode set by the facilitator. No accounts. | "No sign-up" kept, passcode added |
| Names | Always visible. No anonymous mode. | Anonymous topics setting (sections 3, F06, decision 7) |
| Votes | Dot votes and extend votes hidden until everyone has finished, enforced by the database. | Unchanged in intent, now a security rule |
| Export | **Word (.docx) and Excel (.xlsx)** only, generated in the browser, Windows-safe filenames, spreadsheet formula-injection guard. | Markdown, print stylesheet (F24) |
| Retention | Deleted 7 days after the session ends, or 7 days after last activity if never ended. | 30 days (F29, decision 12) |
| Capacity | 3 to 12 people. Soft warning at 10, hard cap 12. Volume is low, so capacity planning is not a concern; the weekly pause risk is, so a daily keep-alive is required. | Section 7 emphasis |
| Stage view | Built for Teams screen sharing: large type, heavy strokes, text labels for every state change, no color-only signals. | Section 5 accessibility, extended |
| Deferred | Hardening for high-stakes hybrid executive meetings (reconnect and resync must work, no failover design). | New |

---

## 1. Purpose and principles

**Purpose:** Let a group of up to about 10 people build an agenda together, vote on it, and discuss topics in timeboxes, from any device, with no sign-up.

**Principles**
1. **One shared, visible clock.** A visible timer helps people notice their own airtime. Basis: [PeopleStorming](https://peoplestorming.substack.com/p/1168805_virtual-lean-coffee-have-topic-prefs).
2. **The group decides.** The facilitator runs the clock; the extend vote decides whether a topic continues.
3. **No sign-up.** A link and a display name are enough.
4. **Bias-resistant by default.** Private brainstorming, hidden votes, optional anonymous topics. Basis: [Retrium](https://retrium.com/resources/techniques/lean-coffee) (private ideation prevents groupthink) and [Lean Change](https://leanchange.org/posts/six-tips-for-facilitating-a-kick-ass-lean-coffee-session) (anonymous topics, hidden votes, no voting on your own topic).
5. **Phone-first for participants.** Facilitators get a desktop-optimized view; everyone can do everything essential from a phone.
6. **Every timer is adjustable.** Sources disagree on defaults (5, 7, 8, or 10 minutes), so defaults are starting points, not rules.

---

## 2. Roles

| | Facilitator | Participant |
|---|---|---|
| How you become one | Creates the board and holds the facilitator secret (stored in the browser, recoverable via a private facilitator link) | Opens the invite link and enters a display name |
| Phase and timer control | Yes | No |
| Add, edit, delete own topics | Yes | Yes |
| Edit or delete any topic, merge, reorder | Yes | No |
| Vote | Yes (counts as a normal participant) | Yes |
| Add actions and take-aways | Yes | Yes |
| Remove a participant, lock the board | Yes | No |

**Decision:** One facilitator per board in v1. Handing off control means sharing the private facilitator link. No co-facilitator role yet.

---

## 3. Session flow

`Lobby → 1 Brainstorm → 2 Clarify → 3 Vote → 4 Discuss (loop per topic) → 5 Wrap-up → Ended`

| Phase | Purpose | Default timer | Range | Who controls | Participants see | Ends when |
|---|---|---|---|---|---|---|
| **Lobby** | Gather, set rules | None | n/a | Facilitator | Who has joined, the rules, a large room code and QR | Facilitator presses Start |
| **1 Brainstorm** | Write topics silently | 5:00 | 2:00 to 10:00 | Facilitator | Own topics only (if "hide topics" is on); count of topics from others | Timer hits 0, or facilitator ends early |
| **2 Clarify** | Reveal, pitch, merge duplicates | 30 s per pitch, soft | Off to 60 s | Facilitator | All topics revealed at once; current pitcher highlighted | Facilitator presses Continue |
| **3 Vote** | Spend dots | 1:30 | 0:30 to 3:00 | Facilitator | Own dots only; "4 of 6 finished" | All finished, timer 0, or facilitator reveals |
| **4 Discuss** | Talk, topic by topic | 5:00 per topic, 3:00 per extension | 3:00 to 10:00 / 1:00 to 5:00 | Facilitator, extend vote | Stage view: topic, big timer, queue, actions | Facilitator ends discussion, or no topics remain |
| **5 Wrap-up** | Take-aways, export | 5:00 soft | Off to 10:00 | Facilitator | Take-away input, export | Facilitator ends session |

**Basis for defaults**
- Brainstorm: 3 to 5 minutes ([Open Practice Library](https://openpracticelibrary.com/practice/lean-coffee/)); 5 to 10 minutes ([Retrium](https://retrium.com/resources/techniques/lean-coffee)).
- Pitch: 15 to 30 seconds per topic ([Lean Project Consulting](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf)).
- Vote: 1 minute in the Xebia cheat sheet ([Xebia](https://xebia.com/media/2026/01/Lean-Coffee-Cheat-Sheet-Xebia.pdf)); under 3 minutes per Miro ([Miro](https://miro.com/templates/basic-lean-coffee/)). **Decision:** 1:30 to leave room for phones.
- Discuss: 5 minutes is the most common default ([Applied Frameworks](https://appliedframeworks.com/how-to-host-a-lean-coffee)); 8 then 4 in the original-style guide ([Lean Project Consulting](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf)); 7 in Atlassian's template ([Atlassian](https://www.atlassian.com/software/confluence/templates/lean-coffee)).

### Phase rules in detail

**Lobby**
- Facilitator sets: board name, planned session length (default 75 min), votes per person, timers, hide topics, anonymous topics, voting on own topics, tie-break method.
- Participants can join at any time, including mid-session.
- Soft cap of 10 participants with a warning; hard cap of 12. Basis: groups work best at 10 or fewer ([Wiesner-Hager](https://wiesner-hager.com/en/about-us/magazine-blog/office-concepts/lean-coffee-as-alternative-to-the-rigid-meeting)); one case study split groups larger than 6 to 7 ([Clearleft](https://clearleft.com/thinking/a-tiny-lesson-using-the-lean-coffee-format-for-large-group-discussions)).

**1 Brainstorm**
- One topic per card, 160 characters max. Basis for brevity: keep words per card to a minimum ([Applied Frameworks](https://archive.appliedframeworks.com/wp-content/uploads/2021/05/LeanCoffee_Summary.pdf)).
- **Decision:** Max 5 topics per person to stop flooding.
- Authors can edit or delete their own cards until Clarify starts.
- With "hide topics" on (default), others' cards stay hidden until the phase ends, then all appear at once.
- With "anonymous topics" on (default off), authors are hidden from everyone, including the facilitator, and omitted from the export.

**2 Clarify**
- Facilitator steps through topics. Each proposer gets a soft 30-second pitch timer. At 0 it chimes but does not cut anyone off.
- Facilitator can merge duplicates by dragging one card onto another. Merged cards show both texts and all authors (unless anonymous). Merge is undoable until voting starts.
- The facilitator can skip the pitch step entirely.

**3 Vote**
- Each person gets N dots (default 3, range 1 to 5). Xebia suggests topics divided by two, capped at 5; the app shows that number as a suggestion. Basis: [Xebia](https://xebia.com/media/2026/01/Lean-Coffee-Cheat-Sheet-Xebia.pdf).
- Dots can be stacked on one topic or spread out, added and removed freely until the phase ends.
- **Decision:** Voting on your own topic is off by default (Lean Change tip). The classic guide allows it ([Lean Project Consulting](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf)), so this is a setting.
- Counts are hidden until reveal. Everyone sees only "4 of 6 finished".
- "I'm done" marks a person finished; it is reversible until the phase ends.
- The phase ends when everyone connected is done, the timer hits 0, or the facilitator reveals early. Reveal is automatic in all three cases.
- After reveal, topics sort by votes, highest first. Ties keep submission order and show a "tied" badge.
- **Tie-break (setting):** (a) Facilitator drags within the tie group (default), (b) one-dot mini-vote among tied topics, 0:30, or (c) random draw. Basis for (b): [Xebia](https://xebia.com/media/2026/01/Lean-Coffee-Cheat-Sheet-Xebia.pdf).

**4 Discuss (per topic)**
1. Facilitator presses **Start discussion** (the top unfinished topic is preselected; it can be changed).
2. The topic moves to Discussing, the timer starts at 5:00, and the proposer is highlighted as "starts the conversation".
3. At 1:00 remaining the timer gets a "1 min left" label (text plus color, never color alone).
4. At 0:00 a chime plays (muteable per person) and the **extend vote** opens automatically. The facilitator may also call it early at any time.
5. **Extend vote:** Keep going / Neutral / Move on. 15-second window. It closes when everyone connected has voted or the window ends. Non-voters count as abstentions.
   - **Rule:** Extend only if Keep going outnumbers Move on. Neutral does not count. A tie or no votes means move on. Basis: [Lean Project Consulting](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf) (continue only if thumbs up outnumber thumbs down). Note that Range counts sideways votes toward continuing ([Range](https://www.range.co/blog/lean-coffee)), so sources differ; the rule is easy to change.
   - Tally is hidden until everyone has voted or the window closes, so early votes do not sway late ones.
   - The facilitator can override with "Extend" or "Move on" after the result shows.
6. **Extend:** the timer restarts at 3:00 (extension default). Originals used half the starting box ([Lean Project Consulting](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf)); 3:00 is the nearest round number to 2:30. **Decision:** No cap on extensions; the facilitator can always override.
7. **Move on:** the topic goes to Discussed with time spent recorded. The next topic is queued but **not auto-started**, so actions can be captured. An "auto-start next" setting is available.

**5 Wrap-up**
- If a planned end time is set, a banner appears at 5 minutes remaining prompting the facilitator to start wrap-up. Basis: hold the retrospective 5 minutes before the end ([Lean Project Consulting](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf)).
- Each person can add one optional take-away; passing is allowed. Basis: take-aways are not mandatory and anyone can pass ([XMind summary](https://xmind.app/m/kctV)).
- Export is offered. The facilitator ends the session.

---

## 4. Function catalog

| ID | Function | Purpose | Who | When | Timing and rules |
|---|---|---|---|---|---|
| F01 | Create board | Start a session | Anyone | Home page | One click; board name optional. Creates a 6-character room code (unambiguous alphabet) and a private facilitator secret. Under 2 s. |
| F02 | Join | Enter a session | Anyone with the link or code | Any phase | Display name 1 to 24 characters. Same browser rejoins with identity and votes restored. Duplicate names get a suffix. Late joiners see the current phase. |
| F03 | Presence | Show who is connected | All | Always | Connected or away (away after 30 s without a heartbeat). Used to decide when "everyone has voted". |
| F04 | Settings | Tune the rules | Facilitator | Lobby; timers editable any time | Changes apply to the next timer, never the one running. |
| F05 | Share | Invite people | Facilitator | Lobby onward | Copy link, large room code, QR code for in-person tables. |
| F06 | Add topic | Build the agenda | All | Brainstorm; mid-session parking lot | 160 characters, 5 per person. Mid-session topics land at the bottom with 0 votes. |
| F07 | Edit or delete topic | Fix mistakes | Author; facilitator for any | Until Clarify; facilitator any time | Instant. |
| F08 | Reveal topics | Avoid anchoring | System | End of Brainstorm | All cards appear at once. |
| F09 | Pitch | Explain each topic | Proposer | Clarify | 30 s soft timer. Chime at 0, no cutoff. |
| F10 | Merge | Group duplicates | Facilitator | Clarify | Drag one card onto another. Undoable until voting starts. |
| F11 | Vote | Prioritize | All | Vote | Dots per person (default 3), add or remove freely, stacking allowed. Enforced on the server. |
| F12 | Finish voting | Signal done | Participant | Vote | Reversible until phase end. |
| F13 | Reveal and rank | Set the agenda | System, facilitator | End of Vote | Sort by votes, mark ties, apply tie-break method. |
| F14 | Start discussion | Begin a topic | Facilitator | Discuss | Starts the 5:00 timer for everyone within about 1 s. |
| F15 | Timer display | Keep time visible | All | Discuss, Vote, Brainstorm, Clarify | Server-authoritative end time; clients compute the countdown locally. Screen-reader announcements at 1:00, 0:30, and 0:00 only. |
| F16 | Pause and resume | Handle interruptions | Facilitator | Any timed phase | Instant; paused time is not counted. |
| F17 | Adjust time | Fine-tune | Facilitator | Any running timer | +1 min, -1 min, or set a value. |
| F18 | Extend vote | Group decides | All | Time's up, or called early | 15 s window; hidden until all voted; rule in section 3. |
| F19 | Next topic | Advance | Facilitator | Discuss | Records time spent; queues the next topic; no auto-start by default. |
| F20 | Skip, defer, reorder | Adapt | Facilitator | Discuss | Deferred topics go to the bottom. Undo within the session. |
| F21 | Re-vote | Refresh priorities | Facilitator | Discuss | Resets dots on remaining topics and reopens Vote for 1:00. Useful after new topics arrive. |
| F22 | Add action | Capture outcomes | All | Always during Discuss and Wrap-up | 140 characters, optional owner (a participant or free text), linked to the current topic. No timer. |
| F23 | Take-aways | Close the loop | All | Wrap-up | One optional line each; pass allowed. |
| F24 | Export | Keep results | All | From Vote onward | Markdown: board name, date, participant count, topics in order with votes and time spent, actions with owners, take-aways. Copy, download, and a print stylesheet. Authors omitted when anonymous. |
| F25 | End session | Close | Facilitator | Any time | Board becomes read-only; export remains available. |
| F26 | Moderation | Keep order | Facilitator | Any time | Remove a participant, lock topic submission, lock the board to new joiners. |
| F27 | Planned end time | Pace the session | Facilitator | Lobby | Default 75 minutes. Shows time left; prompts wrap-up at 5 minutes remaining. |
| F28 | Theme | Comfort | Each user | Any time | Light default, follows system, manual dark toggle. |
| F29 | Expiry | Privacy and cleanup | System | After session | Board deleted 30 days after last activity. |

---

## 5. Clock and timer rules

1. **Server-authoritative.** Each running timer stores a server-side end timestamp. Clients compute the remaining time locally and correct for clock skew. The app must not write to the database every second.
2. **Pause** stores the remaining milliseconds; **resume** computes a new end timestamp.
3. **Reconnect or refresh** recomputes from the stored timestamp, so a returning user sees the correct time immediately.
4. **Backgrounded phones** resync when the tab becomes visible again.
5. **Extend vote** has its own 15-second window using the same mechanism.
6. **Accessibility:** Timers can be lengthened or switched off by the facilitator, and sound is optional per person. Visual changes (such as the 1:00 label) never rely on color alone. Respect reduced-motion preferences for the ring animation.

---

## 6. Session time budget (worked example)

8 people, 9 topics, 75-minute session. The original guide recommends 75 minutes with a 60-minute minimum ([Lean Project Consulting](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf)); a 90-minute adaptation is also documented ([Clearleft](https://clearleft.com/thinking/a-tiny-lesson-using-the-lean-coffee-format-for-large-group-discussions)).

| Block | Minutes |
|---|---|
| Lobby and check-in | 2 |
| Brainstorm | 5 |
| Clarify (9 pitches x 30 s) | 4.5 |
| Vote | 1.5 |
| Wrap-up | 5 |
| Transitions and slack | 5 |
| **Left for Discuss** | **about 52** |

At 5:00 plus one 3:00 extension, a topic takes up to 8:00, so about 6 or 7 topics fit. With no extensions, about 10. The app should show a live "topics we can still fit" estimate in the stage view so the group sees the cost of extending. **Decision:** include this estimate; it is a small calculation and makes the tradeoff visible.

---

## 7. Realtime, capacity, and limits

**Supabase free plan, as published:**
- 200 concurrent Realtime connections, 100 messages per second, 20 presence messages per second ([Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits)).
- 2 million Realtime messages per month, 2 active projects, and projects pause after 1 week of inactivity ([Supabase pricing](https://supabase.com/pricing)).

**Implications (my arithmetic, so treat as estimates [Verify This]):**
- With 10 people per board and one connection each, about 20 boards can run at the same moment.
- A session with 8 people might generate a few hundred events, each delivered to 8 clients, so a few thousand messages. That suggests several hundred sessions per month inside the free allowance.
- Because of project pausing, the app needs a keep-alive (a weekly scheduled request) or the first visitor after a quiet week hits a paused database. Step 4 will include this.

---

## 8. Edge cases

| Case | Behavior |
|---|---|
| Facilitator disconnects | Timers keep running on the server. Facilitator reconnects with the same browser or the private facilitator link. Participants see "Facilitator reconnecting". |
| Facilitator loses the secret | The board cannot be controlled; participants can still export. Warn at creation to save the facilitator link. |
| Participant refreshes | Identity, dots, and votes restored from the browser. |
| Participant joins mid-vote | Gets a full set of dots; counted in "finished" totals. |
| Participant leaves mid-vote | Their dots stay; they no longer block "everyone finished". |
| Zero topics at Clarify | Facilitator prompted to extend Brainstorm or end. |
| One participant | Allowed; extend vote resolves from that single vote. |
| Everyone ties on votes | Tie-break method applies to the whole set. |
| Timer reaches 0 while paused | Not possible; paused timers do not count down. |
| Extend vote with no responses | Move on. |
| Two facilitator tabs | Last action wins; timer state is server-side so both stay consistent. |
| Offline participant | Banner "Reconnecting"; actions queue briefly and then report failure rather than silently dropping. |
| Board older than 30 days | Not found page with a link to create a new board. |
| Very long topic text | Blocked at 160 characters with a visible counter. |

---

## 9. Design status: what the hybrid still needs

| Screen | Source mockup | Status |
|---|---|---|
| Home and create board | None | **Needs design** |
| Join (display name) | None | **Needs design** |
| Lobby (settings, room code, QR) | Partial from C's rules panel | **Needs design** |
| Brainstorm | None | **Needs design** |
| Clarify (pitch, merge) | None | **Needs design** |
| Vote (facilitator panel) | C | Done; counts-hidden rule already shown |
| Discuss stage, extend vote | B | Done, with one change: B currently shows a live tally; per this spec the tally is hidden until everyone has voted. Light and dark versions needed. |
| Board overview tab | A | Done; add dark mode |
| Phone extend vote | Phone artboard | Done |
| Wrap-up and export | Export button only | **Needs design** |
| Dark theme for C and A | None | **Needs design** |

---

## 10. Decisions to confirm

| # | Decision | My default | Alternatives |
|---|---|---|---|
| 1 | Discussion timebox | 5:00 | 7:00 or 8:00 |
| 2 | Extension length | 3:00 | 2:30 or 4:00 |
| 3 | Extend rule | Keep going must beat Move on; ties move on | Sideways counts toward continue |
| 4 | Extend tally | Hidden until all voted | Live |
| 5 | Voting on own topic | Off | On (classic) |
| 6 | Dots per person | 3 | 2 (classic) |
| 7 | Anonymous topics | Off | On |
| 8 | Hide topics during brainstorm | On | Off |
| 9 | Topic cap per person | 5 | None |
| 10 | Tie-break | Facilitator drags | Mini-vote or random |
| 11 | Auto-start next topic | Off | On |
| 12 | Board retention | 30 days | 7 or 90 days |
| 13 | Participant hard cap | 12 | 10 or 20 |

---

## 11. Out of scope for v1

Accounts and saved history, payments, Slack/Teams/Jira integrations, AI summaries, co-facilitators, async or multi-day sessions, multiple concurrent breakout tables.

---

## Sources

- [Lean Coffee home](https://leancoffee.org/)
- [Lean Project Consulting, How to Conduct a Lean Coffee](https://cca-acc.com/wp-content/uploads/2021/08/How-to-Conduct-a-Lean-Coffee-Lean-Project-Consulting.pdf)
- [Retrium, Lean Coffee](https://retrium.com/resources/techniques/lean-coffee)
- [Xebia cheat sheet](https://xebia.com/media/2026/01/Lean-Coffee-Cheat-Sheet-Xebia.pdf)
- [Open Practice Library](https://openpracticelibrary.com/practice/lean-coffee/)
- [Applied Frameworks guide](https://appliedframeworks.com/how-to-host-a-lean-coffee) and [summary PDF](https://archive.appliedframeworks.com/wp-content/uploads/2021/05/LeanCoffee_Summary.pdf)
- [Lean Change, six facilitation tips](https://leanchange.org/posts/six-tips-for-facilitating-a-kick-ass-lean-coffee-session)
- [Clearleft, large group adaptation](https://clearleft.com/thinking/a-tiny-lesson-using-the-lean-coffee-format-for-large-group-discussions)
- [Atlassian template](https://www.atlassian.com/software/confluence/templates/lean-coffee) and [Miro template](https://miro.com/templates/basic-lean-coffee/)
- [Range](https://www.range.co/blog/lean-coffee), [XMind summary](https://xmind.app/m/kctV), [PeopleStorming](https://peoplestorming.substack.com/p/1168805_virtual-lean-coffee-have-topic-prefs), [Wiesner-Hager](https://wiesner-hager.com/en/about-us/magazine-blog/office-concepts/lean-coffee-as-alternative-to-the-rigid-meeting)
- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits) and [Supabase pricing](https://supabase.com/pricing)
