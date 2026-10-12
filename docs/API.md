# REST API

Base URL: `http://127.0.0.1:4310/api`. Use `Content-Type: application/json` on writes. When configured, every API request requires `Authorization: Bearer <APP_TOKEN>`. Responses are JSON unless exporting CSV. Errors have `{ "error": "message" }` with an appropriate 4xx/5xx status.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Version and server status |
| GET | `/config` | Boolean provider configuration, model name, scheduler interval, busy projects; no secrets |
| GET / POST | `/projects` | List projects / create project |
| GET / PATCH / DELETE | `/projects/:id` | Read, edit, or permanently delete project and related data |
| GET | `/projects/:id/opportunities` | Stored records |
| GET | `/projects/:id/events` | Most recent 60 activity events |
| POST | `/projects/:id/import` | `{ "items": [...] }`, 1–200 validated source records |
| POST | `/projects/:id/sync` | `{ "provider": "reddit" }` or `{ "provider": "google" }` |
| POST | `/projects/:id/keywords` | `{}`; suggest keywords without applying them |
| POST | `/projects/:id/research` | `{}`; bounded research of the configured public website, returning page links and reviewable extracted text |
| GET | `/projects/:id/export` | JSON project, items, activity and export timestamp |
| GET | `/projects/:id/export?format=csv` | Conversation CSV with spreadsheet formula protection |
| GET / PATCH / DELETE | `/opportunities/:id` | Read, edit workflow fields, or remove a record |
| POST | `/opportunities/:id/draft` | `{}`; generate and save AI draft or clearly labeled template |
| POST | `/opportunities/:id/analyze` | `{}`; AI analysis when configured, otherwise recalculate rules |

Create a project with `name`, HTTPS `website`, and optional `description`, `audience`, `voice`, `keywords` (string array), `competitors` (string array), `ignoredSubreddits` (string array), `monitoring` (boolean). Project PATCH accepts those same fields. Name is required, at most 80 characters. Description is at most 5000. Up to 20 keywords and 10 competitors are supported. Settings edits recalculate rules-based classifications.

AI analysis, keyword suggestions, and drafts use OpenAI when both `OPENAI_API_KEY` and `OPENAI_MODEL` are configured; otherwise they use Ollama when `OLLAMA_MODEL` is configured. If neither provider is configured, analysis is rules-based and drafts are labeled templates. `OPENAI_BASE_URL` is an optional administrator-controlled OpenAI-compatible API origin.

Website research uses the project's configured HTTPS website; the request body cannot select a URL. It checks `robots.txt`, resolves and pins public DNS addresses, reads at most four HTML pages on that same hostname, and returns at most 20,000 characters. Redirects are rejected, each response is limited to 1 MB and 12 seconds, and a missing or unavailable robots file limits research to the homepage. Review text before adding it to product context. This endpoint does not use AI or require a scraping service API key.

Opportunity PATCH accepts `draft`, `notes` (each at most 15000 characters), `saved` (boolean), `status` (`new`, `reviewing`, `replied`, `dismissed`), and `contactStage` (`none`, `interested`, `contacted`, `responded`, `converted`). IDs, ownership, provider attribution, and URLs cannot be modified by PATCH. There is no external posting endpoint.

Import shape is documented in the README. URLs are validated as HTTPS Reddit thread/comment permalinks and normalized. The entire batch is validated before any write. Source records are always attributed to import, not to a live provider. Duplicate URLs are skipped; import does not restore workflow state from an export. Bad entries reject the entire batch with 400. Requests exceeding 2 MB return 413.

Sync is synchronous over HTTP. The frontend displays progress while waiting; allow enough client timeout for up to ten sequential requests. Each upstream request times out at 90 seconds. A conflicting run returns 409. Provider failures return 502, and missing credentials return 400. Sample projects reject discovery/import so fictional and live records do not mix. Costs are incurred by configured providers, not by this app's license.

## Example

```sh
curl http://127.0.0.1:4310/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"My product","website":"https://example.com","keywords":["project management"]}'
```

Use a secure environment-based header when authentication is enabled; avoid storing credentials in shell history. The server is a shared trusted workspace, not a public multi-tenant API.
