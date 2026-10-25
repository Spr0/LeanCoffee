# Backlog

Tempting but out of scope for v1. Add with a one-line reason.

| Item                                              | Source                  | Why deferred                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR code in the Lobby                              | Spec F05                | In-person tables only; sessions run on Teams.                                                                                                                                |
| Supabase branching (staging database)             | Decision D2             | Paid feature; revisit if teams rely on the app.                                                                                                                              |
| Disable the unused Supabase Email provider        | Setup check             | Optional hardening; needs a dashboard change by Scott.                                                                                                                       |
| Recovery link on a locked or full board           | Phase 2 QA              | On a new device the recovery link must join first, so a locked or full board blocks it. Needs a token-aware join RPC. Workaround: the current facilitator unlocks the board. |
| Rotate the recovery token when the owner reclaims | Phase 5 security review | Today a leaked recovery link keeps working; the mitigation is remove plus lock. Needs a migration and the creator's browser to store the new token.                          |
