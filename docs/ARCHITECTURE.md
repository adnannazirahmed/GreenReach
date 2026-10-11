# Architecture and operations

## Runtime

Node 24 serves a static ES-module frontend and a JSON API using `node:http`. Native `node:sqlite` stores projects and opportunities as validated JSON documents, with indexed project IDs, unique per-project canonical URLs, and an append-only activity table. There is no package installation or asset build step. SQLite runs in WAL mode with a busy timeout.

`server/domain.js` contains validation, canonicalization, scoring, and exports. `store.js` owns SQL and transactions. `providers.js` contains external network and AI boundaries. `index.js` contains routing and scheduling. `mcp.js` bridges read-only JSON-RPC tools to the authenticated API. `seed.js` creates a fictional demo only when the database has no projects at startup. `public/app.js` renders the dashboard and sends state changes through the API.

## Data flow

1. A user defines product facts, audience, voice, keywords, competitors, and exclusions. Website URL is metadata, not fetched content.
2. A manual import or optional discovery run normalizes source records. Reddit OAuth queries posts; Google discovery filters natural keyword search results to Reddit permalinks. Locked, archived, and NSFW posts are skipped by the Reddit adapter.
3. Canonical permalinks deduplicate within each project. A Google snippet and a Reddit post for the same permalink converge on the same record. User-authored draft, notes, state, and pipeline stage survive sync.
4. Rules assign relevance factors, buying intent, overall sentiment, and literal brand matches. Ignored communities score zero and are excluded from working views.
5. Optional explicit AI analysis blends a model relevance score with the rules score. Optional draft generation sends the supplied text and product context to Ollama; the user edits, copies, posts externally, and manually marks replied.
6. Counts and charts derive from stored records. No metrics estimate reach or revenue. MCP only reads these records.

## Scoring

Rules sum five explicit components and cap at 100:

| Component | Maximum | Rule |
| --- | --- | --- |
| Relevance | 35 | 12 points per literal keyword match, plus 12 if any tracked brand matches |
| Intent | 30 | 30 for recommendation/alternative language; otherwise 18 for pain language, otherwise 5 |
| Freshness | 15 | 15 for under 2 days, 8 under 14 days, 2 for older, 0 for unknown |
| Search position | 14 | `max(0, 15 - position)` for an observed Google position |
| Engagement | 5 | One point per five comments, capped at 5 |

The score is a prioritization heuristic, **not a probability**. Literal matching can misclassify common brand names and negation. Text-level sentiment is not brand-level sentiment. Rules do not understand sarcasm. Updates recalculate scores; time passing alone does not continuously rescore the database.

AI analysis requests structured output with bounded relevance, a fixed intent enum, a fixed sentiment enum, and reasoning. The blended score is `round(0.4 × ruleScore + 0.6 × modelRelevance)`. Invalid output fails visibly and leaves the prior analysis intact. Prompts treat source material as untrusted and discourage fabricated experience or features. This reduces but does not eliminate model errors. Source content cannot invoke tools; generated output is rendered as text.

## Discovery and scheduling

Each provider run searches up to ten unique terms, in order: project keywords, name, competitors. Large keyword lists may use the whole budget before competitor terms are reached. Requests are sequential, bounded, and timed out at 90 seconds; there are no automatic network retries. One provider run can be active per project. Results commit only after all queries succeed. Failures are recorded in the activity log. A repeated matching URL may increment the refreshed counter more than once if it appears for multiple queries.

Google ranks are US/English organic positions at collection time. Only the latest matched keyword/position is retained per opportunity, not a full rank history or multiple keyword mappings. Reddit search does not supply SEO volumes. Imported volumes are user-supplied. Snippets are not full threads; users must open the original before engaging.

The scheduler starts only for `SYNC_INTERVAL_MINUTES > 0`, waits at least five minutes between ticks, and processes projects that also enable monitoring. It runs only while the process is alive and does not catch up missed intervals. Conflicting runs are rejected. A durable queue, provider budgets, pagination/checkpoints, exponential backoff, and deletion reconciliation belong to later releases.

## Security and deployment

Local access is the default. A loopback server validates Host headers to resist DNS rebinding and rejects cross-origin requests. JSON endpoints require JSON content types, input lengths, enum validation, and maximum import/request sizes. Source URLs accept HTTPS Reddit thread/comment links only. External discovery endpoints are fixed; there is no user-controlled website fetch endpoint. The Ollama endpoint is administrator-controlled environment configuration and may intentionally target localhost.

When binding outside loopback, `APP_TOKEN` is required. Tokens are compared with timing-safe equality and never returned in configuration responses. The frontend keeps an entered token in sessionStorage, cleared when that browser session ends; it is accessible to scripts in that origin, so do not serve unrelated scripts from this origin. The browser loads no third-party scripts, fonts, or analytics. All record text is HTML-escaped, CSP blocks inline scripts, and CSV export prefixes formula-leading strings.

The shared token is not multi-user authentication. All authorized users can read and edit all projects. Put remote deployments behind HTTPS and an authenticated proxy. The app does not implement distributed locks, a global rate limiter, audit-grade records, or optimistic locking; a trusted single operator is the intended first-release deployment. A malicious or stalled upstream body can still consume resources up to timeout; do not expose the server to untrusted users.

Ollama receives project facts, supplied thread text, and notes when drafting. Keep sensitive information out of content sent to a remote model server. Provider keys stay in the environment and `.env` is ignored. Google keys are carried in requests to its provider endpoint, as required by that API; requests and URLs are not logged by this app.

## Back up and restore

For a simple consistent backup, stop the server and copy the entire `data` directory, including any SQLite WAL/SHM companions. Restore it while the server is stopped. Keep `.env` separately and restrict access to both: conversations and private drafts may be sensitive. JSON/CSV exports are for portability and inspection, not a full restore mechanism. There are no schema migrations beyond initial table creation in version 0.1.0.

## Data access boundaries

Only import material you are authorized to retain. An OAuth client does not itself guarantee commercial Reddit API access. Read the current [Reddit API documentation](https://www.reddit.com/dev/api/) and obtain the required permission for your use. Review the selected search provider's terms and account permissions. This application does not bypass access restrictions or promise exhaustive coverage. It does not automatically reconcile removed Reddit content; operators must manage retention and deletion until that functionality exists.

API implementations reference [Ollama chat](https://docs.ollama.com/api/chat), [Reddit OAuth](https://github.com/reddit-archive/reddit/wiki/OAuth2), [SerpAPI Google results](https://serpapi.com/search-api), and the [MCP stdio specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports). Live accounts are not included.
