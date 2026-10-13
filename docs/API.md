# REST API

Base URL: `http://127.0.0.1:4310/api`. Use `Content-Type: application/json` on writes. When configured, every API request requires `Authorization: Bearer <APP_TOKEN>`. Responses are JSON unless exporting CSV. Errors have `{ "error": "message" }` with an appropriate 4xx/5xx status.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Version and server status |
| GET | `/config` | Boolean provider configuration, model name, scheduler interval, busy projects; no secrets |
| PATCH | `/config/credentials` | `{ "credentials": { "OPENAI_API_KEY": "..." }, "clear": ["SERPAPI_KEY"] }`; store or clear supported provider values |
| GET / POST | `/projects` | List projects / create project |
| GET / PATCH / DELETE | `/projects/:id` | Read, edit, or permanently delete project and related data |
| GET | `/projects/:id/opportunities` | Stored records |
| GET | `/projects/:id/events` | Most recent 60 activity events; storage retains up to 500 per project |
| POST | `/projects/:id/import` | `{ "items": [...] }`, 1–200 validated source records |
| POST | `/projects/:id/sync` | `{ "provider": "reddit" }`, `google`, `web`, `hackernews`, `stackexchange`, `github`, or `devto` |
| POST | `/projects/:id/keywords` | `{}`; suggest keywords without applying them |
| POST | `/projects/:id/research` | `{}`; bounded research of the configured public website, returning page links and reviewable extracted text |
| GET | `/projects/:id/export` | JSON project, items, activity and export timestamp |
| GET | `/projects/:id/export?format=csv` | Conversation CSV with spreadsheet formula protection |
| GET / PATCH / DELETE | `/opportunities/:id` | Read, edit workflow fields, or remove a record |
| POST | `/opportunities/:id/draft` | `{}`; generate and save AI draft or clearly labeled template |
| POST | `/opportunities/:id/analyze` | `{}`; AI analysis when configured, otherwise recalculate rules |

Create a project with `name`, HTTPS `website`, and optional `description`, `audience`, `voice`, `keywords` (string array), `competitors` (string array), `researchDomains` (up to 10 public exact hostnames), `ignoredSubreddits` (string array), and `monitoring` (boolean). Project PATCH accepts those same fields. Name is required, at most 80 characters. Description is at most 5000. Up to 20 keywords and 10 competitors are supported. Settings edits recalculate rules-based classifications.

AI analysis, keyword suggestions, and drafts use OpenAI when both `OPENAI_API_KEY` and `OPENAI_MODEL` are configured; otherwise they use Ollama when `OLLAMA_MODEL` is configured. If neither provider is configured, analysis is rules-based and drafts are labeled templates. `OPENAI_BASE_URL` is an optional administrator-controlled OpenAI-compatible API origin.

The Settings screen can store Reddit, SerpAPI, optional GitHub, and OpenAI values in the SQLite credential table, encrypted with AES-256-GCM. `/api/config` returns provider capability and credential-presence booleans only; it never returns values. Blank fields keep current values. A `clear` entry removes only the saved database value, so an environment value can still supply that credential. GreenReach generates `greenreach.credentials.key` beside the database on first run unless `CREDENTIALS_ENCRYPTION_KEY` supplies a base64-encoded 32-byte key. Keep the key with backups of the database; losing it makes saved credentials unrecoverable.

Website research uses the project's configured HTTPS website; the request body cannot select a URL. It checks `robots.txt`, resolves and pins public DNS addresses, reads at most four HTML pages on that same hostname, and returns at most 20,000 characters. Redirects are rejected, each response is limited to 1 MB and 12 seconds, and the full lookup and crawl has a 60-second deadline. A missing or unavailable robots file limits research to the homepage. Review text before adding it to product context. This endpoint does not use AI or require a scraping service API key.

The `web` sync provider requires SerpAPI and at least one project `researchDomains` hostname. It makes at most 10 Google searches across the configured domains and project terms, then fetches at most eight unique result pages within a two-minute total deadline. Only exact HTTPS hosts configured in the project are eligible; GreenReach checks robots.txt, resolves and pins public DNS, rejects redirects, and skips inaccessible pages. Extracted records include a heuristic page type and extraction score plus available author/date metadata. Listings and pages with under 80 characters of readable text are skipped. Search snippets alone are not stored as opportunities. SerpAPI may charge per query.

Opportunity PATCH accepts `draft`, `notes` (each at most 15000 characters), `saved` (boolean), `status` (`new`, `reviewing`, `replied`, `dismissed`), and `contactStage` (`none`, `interested`, `contacted`, `responded`, `converted`). IDs, ownership, provider attribution, and URLs cannot be modified by PATCH. There is no external posting endpoint.

Import shape is documented in the README. URLs are validated as HTTPS permalinks for Reddit, Hacker News, Stack Overflow/Stack Exchange, GitHub Issues/Discussions, DEV articles, or an exact hostname configured in `researchDomains`. The entire batch is validated before any write. Source records are always attributed to import, not to a live provider. Duplicate URLs are skipped; import does not restore workflow state from an export. Bad entries reject the entire batch with 400. Requests exceeding 2 MB return 413.

Sync is synchronous over HTTP. The frontend displays progress while waiting; allow enough client timeout for up to ten sequential requests. Each upstream request times out at 90 seconds. A conflicting run returns 409. Provider failures return 502, and missing credentials return 400. Sample projects reject discovery/import so fictional and live records do not mix. SerpAPI and Reddit may incur charges; GitHub, HN Algolia Search, Stack Exchange, and Forem have their own rate limits and reuse rules. Google results are kept only when they point to a supported discussion source.

## Example

```sh
curl http://127.0.0.1:4310/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"My product","website":"https://example.com","keywords":["project management"]}'
```

Use a secure environment-based header when authentication is enabled; avoid storing credentials in shell history. The server is a shared trusted workspace, not a public multi-tenant API.
