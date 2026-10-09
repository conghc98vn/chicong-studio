# Final release review — 09/10/2026

## Fixes in the final pass

- Rate-limit reservations now stop atomically at the limit. Concurrent retries cannot leave rejected reservations charged against the successful-inquiry quota.
- Saved request identity is checked before changing date restrictions. A historical saved inquiry can replay; a new request with a past date still fails validation.
- Client date availability is advisory; the server resolves retries before checking current availability. Invalid fields remain checked locally.
- Calendar month navigation restores keyboard focus, including returning to the current month where the previous-month button becomes disabled.
- The shared API timeout covers reading the response body as well as waiting for headers.
- Generated screenshots and exports under output are excluded from Git. GitHub Actions runs syntax checks and the complete test suite on pushes to main and pull requests.

## Verification before release

- npm run check: passed.
- npm test: 45/45 passed, including concurrent retries, historical replay, migrations, private galleries, uploads, booking conflicts and CSRF protections.
- npm audit --omit=dev: no known vulnerabilities reported at verification time.
- Git remote main matched the local base before release; no remote commits were overwritten.
- Public production inventory before release: 7 albums, 284 photos; health endpoint healthy. No customer data was changed by the release review.
- Browser keyboard check: Enter on next month preserved focus on the replacement button.
- Disposable browser fixture simulated a lost response after saving. The browser retried and showed a successful request reference.

Earlier desktop and mobile checks are documented in consultation-enhancements-2026-10-08.md. Local automated database tests use SQLite; PostgreSQL and production smoke-check results must be recorded separately after deployment. A physical phone and a real mobile network were not tested.

## Additional loading and optimization release

Scope: loading screen with “Một chút nữa thôi…”, hidden startup fallback and retry handling; Portfolio / About / Contact navigation; hidden services page; portfolio query batching, media validators and settings initialization batching; dashboard album label correction.

Pre-release verification: npm run check passed; npm audit --omit=dev reported 0 vulnerabilities; full npm test with disposable PostgreSQL 16 passed 66/66, no skipped tests. git diff --check passed. Browser checks cover desktop About navigation and mobile menu/Contact at 390px. Earlier startup tests verified delayed imports, failed imports and reload recovery. No database schema or production credentials are changed in this release.

Production verification will follow deployment.

## Production verification — 09/10/2026, 21:04 GMT+7

Resumed the pending release. GitHub main matched local commit `389c4a6`; Render was still serving `e857b4e`. Render deployment `dep-db4f8ijbc2fs73bjo9lg` deployed `389c4a6` successfully in 35.3 seconds.

- Public health: HTTP 200 with `ok: true`.
- `/app/bootstrap.js`, `/app/main.js`, and `/app/public.css`: HTTP 200 and exact matches to local release files.
- `/services`: HTTP 302 to `/`, as intended.
- Portfolio cards API: HTTP 200, 7 published albums after deployment.
- Browser: startup message “Một chút nữa thôi…” transitions to the homepage; Portfolio / About / Contact labels appear; Contact navigation opens the consultation form. No error-level browser logs observed in this session.
- Local rerun: syntax check passed; 65 tests passed, 1 PostgreSQL test skipped because no disposable PostgreSQL URL was configured. This does not replace the earlier 66/66 PostgreSQL verification.
- Evidence: `output/resume-2026-10-09/deploy.jpg` (ignored by Git).

No production form was submitted in this pass. Private gallery, upload, mobile layout and email delivery were not re-tested during this deployment verification. Core Web Vitals and load testing remain unmeasured.
