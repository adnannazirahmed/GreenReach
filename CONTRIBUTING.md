# Contributing to GreenReach

Use Node.js 24 or newer. Run `npm start`, `npm run check`, and `npm test`. No package install is necessary. Keep `.env`, real customer data, and SQLite files out of commits.

Before expanding a workflow, read `docs/RESEARCH.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`. Changes should preserve source attribution, fictional-data labels, explicit AI/template distinctions, data portability, and manual review of external replies.

Add meaningful tests for new ingestion, persistence, access control, and provider behavior. Use fixtures instead of paid API calls in the test suite. Do not introduce external posting or messaging as a side effect of ordinary discovery or editing. Keep external endpoints bounded and validate structured model output.

Document newly implemented capabilities in README. Roadmap targets are not release claims. Bug reports should include Node version and reproduction steps; redact credentials and customer content.
