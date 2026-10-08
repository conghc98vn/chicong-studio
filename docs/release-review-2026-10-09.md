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
