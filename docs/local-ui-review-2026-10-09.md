# Local public website review — 2026-10-09

Scope: local preview only. No deployment or production writes.

## Changes

- Portfolio uses equal desktop columns and 4:5 cover frames, matching the homepage. Three columns above 1000px, two on tablet, natural image proportions in the mobile single-column view.
- Related album covers align on desktop as well.
- Public supporting text uses the existing self-hosted Cormorant font. Corrected remaining small page labels, process numbers, and form errors; kept large headings unchanged.
- Added the configured Zalo link to direct contact actions and formatted the existing phone number for reading, preserving the tel destination.
- The floating, icon-only back-to-top button appears after 50% of the scrollable distance. It hides while a form input is focused and respects reduced-motion preferences.
- Previous local changes to album spreads and footer remain included.

## Verification

- `npm run check`: passed.
- `npm test`: 65 passed, 0 failed, 1 PostgreSQL test skipped without its dedicated database configuration.
- Browser review at widths 360, 390, 768, and 1440: home, Portfolio, About, Contact, and Celebrating Love. No horizontal overflow; contact destinations match configured settings; no public admin link.
- Portfolio desktop cover ratios and top alignment verified; mobile natural ratios retained.
- Mobile menu navigation, album opening, lightbox next/previous/Escape, 49%/51% button visibility, and return to top passed.
- Contact form checked against a disposable local SQLite database and a stub mailer: invalid phone rejection, calendar navigation, focused-input button hiding, simulated failed request with draft retained, successful retry, one saved inquiry, and confirmation focus passed. No real email sent.
- Captures in ignored `output/final-*.png`; disposable browser script in `output/public-review-smoke.mjs`.

Limitations: browser viewport simulation, not physical-device verification. External contact destinations checked against configuration; no messages or calls initiated. Production deployment and actual email delivery are outside this local review.
