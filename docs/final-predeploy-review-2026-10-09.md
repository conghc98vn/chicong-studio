# Final pre-deployment review — 2026-10-09

Scope: all current tracked changes and new source files, including public layouts, slideshow, back-to-top behavior and Google Calendar integration. No push or deployment performed.

## Findings fixed

- Google Calendar expansion previously stopped at midnight at the start of the final selectable day. Timed bookings later that day were omitted although the date was still accepted. Expansion now includes the full final day in Vietnam time. A regression test verifies daytime events, events crossing midnight and rejection beyond the window.
- Google conflicts returned HTTP 409 without a date field error. The inquiry form consequently did not refresh stale availability or focus the affected field. Conflicts and unavailable/out-of-range dates now include `fields.date`, using the form's existing recovery flow.

## Verification

- Full automated suite with the existing disposable PostgreSQL container: **75 passed, 0 failed, 0 skipped**. The PostgreSQL test uses and cleans an isolated schema.
- JavaScript syntax and `git diff --check`: passed.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- Calendar tests also passed with the host timezone set to UTC.
- Browser smoke review: Home, Portfolio, About, Contact and Celebrating Love at 360, 390, 768 and 1440px; no horizontal overflow or uncaught JavaScript errors. Checked cover proportions, contact links, mobile menu, lightbox navigation/Escape, back-to-top threshold and reduced-motion behavior.
- Disposable contact fixture: validation, calendar navigation, input focus, simulated request failure, retained draft, successful retry and one saved inquiry with stubbed email.
- Dedicated Google conflict browser fixture: availability changes after the page loads; submission is rejected, date error receives focus, calendar marks that date busy, and clearing the date permits one successful consultation submission.
- Visual inspection of regenerated mobile Contact and desktop album captures. Evidence and disposable scripts are under ignored `output/`.

## Deployment notes

- Include new source modules and `package-lock.json` in the commit. The Render build already uses `npm ci --omit=dev` and Node 24.
- Configure `GOOGLE_CALENDAR_ICS_URL` in the hosting secret environment and `GOOGLE_CALENDAR_INCLUDE_FREE=true` to retain the locally configured booking rule. `.env` is Git-ignored and will not be deployed by pushing code.
- Production health, calendar configuration and real email delivery require verification after deployment. Browser checks used simulated viewport sizes, not physical devices. No production records or emails were created during this review.
