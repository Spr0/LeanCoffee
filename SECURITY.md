# Security

Status: **stub** (Phase 0). Completed in Phase 5 per build prompt section 4.10.

## Reporting

Contact the owner directly. Do not open a public issue for a vulnerability.

## To be completed

- Threat model (assets, attackers, out of scope)
- What is stored and for how long (7-day retention after session end or last activity)
- How access works (anonymous sign-in, private link, optional passcode, membership-keyed RLS)
- Rotating the Supabase publishable key and JWT signing keys
- If a link leaks: lock the board, remove people, end the session
- Known limits and residual risks, including:
  - Anyone with the link can join until the board is locked; names are self-asserted.
  - No CAPTCHA on anonymous sign-ins (Turnstile declined); relies on the Supabase per-IP limit.
  - One Supabase project, no staging database; migrations are proven in CI first.
  - The Supabase Email provider is enabled but unused by the app.
  - Removal blocks the removed person's identity, but anyone with the link can sign in again with a new anonymous identity and rejoin until the board is locked. Lock the board after removing someone.
  - The board owner cannot be removed, so the recovery link always works.

## Controls already in place (Phase 0)

- ESLint fails the build on `dangerouslySetInnerHTML` or `innerHTML`.
- CI: `npm audit --audit-level=high`, full-history gitleaks scan, check that the build output holds no privileged keys.
- Pre-commit gitleaks hook (`.githooks/pre-commit`).
- GitHub Actions pinned to commit SHAs; Dependabot for npm and Actions.
- `<meta name="referrer" content="no-referrer">` so board codes never leak in a Referer header (HTTP header added in Phase 5).
