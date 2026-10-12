# GreenReach roadmap

GreenReach is an independent open-source implementation of a community opportunity workflow. This roadmap describes planned scope and acceptance criteria; it is **not a claim of full Redreach feature parity**. The README and running application are the authority for what the current release actually implements. Research and primary references are in [RESEARCH.md](RESEARCH.md).

## Initial release: complete local workflow

Build a usable self-hosted application around projects, configurable keywords and competitors, an opportunity queue, optional AI assistance, and recorded outcomes.

| Area | Initial implementation target | Honest boundary |
| --- | --- | --- |
| Project setup | Editable identity, domain, description, keywords, competitors, exclusions; optional bounded public-site text research | Website research covers four same-host HTML pages, not a full website audit |
| Discovery | Reddit OAuth post search, Google organic results via SerpAPI, and JSON import | Credentials and provider access are required for live connectors; CSV is export-only in this release |
| Sample workspace | Clearly labeled synthetic records for exploring every main workflow | Demo activity is not live monitoring or measured customer performance |
| Ranking | Explainable deterministic scoring; optional Ollama classification | Baseline scores are rules, not AI predictions or conversion probabilities |
| Opportunity review | Search, filter, save, dismiss, and inspect source/context | Imported snippets are not necessarily complete Reddit threads |
| Mentions | Detect configured brands and competitors in available records | No claim of comprehensive site-wide comment ingestion |
| Reply studio | Generate, edit, save, copy, and open the source discussion | The user posts; copying does not mark a reply as published |
| Pipeline | Track opportunities and notes through manual stages | No private inbox synchronization or automated outbound messages |
| Insights | Counts, status distribution, communities, sentiment, recorded outcomes | No fabricated reach, traffic, conversion, or ROI estimates; a source-mix chart remains planned |
| Persistence | Node 24 native SQLite | Single-instance local deployment, not hosted enterprise tenancy |
| Synchronization | Manual sync and bounded periodic sync while the service runs | Not an always-on hosted monitor when the process is stopped |
| Interoperability | Local API and read-only stdio MCP | No parity claim with a remote OAuth MCP integration |
| Distribution | Source, license, configuration example, setup docs, meaningful checks | Open-source does not make upstream data providers or inference hardware free |

Acceptance criteria:

- A fresh installation starts with documented commands and survives restart without losing user edits.
- A project can be created and its own opportunities remain separated from other projects.
- Imports are validated and repeated records do not repeatedly inflate the queue.
- Source failures and inactive connectors are visible, with no silent substitution of demo content.
- Changing state persists through refresh; new ingestion does not overwrite human pipeline decisions.
- Generated suggestions are editable and traceable to their provider, with a clearly labeled fallback.
- External links are validated, secrets stay on the server, and user content is rendered safely.
- Read-only MCP can discover its tools and query stored data without making changes or posting.

## Phase 2: deeper retrieval and quality

1. Add authorized comment and full-thread retrieval with pagination, bounded context, and coverage indicators. Define an explicit retention and source-deletion reconciliation process.
2. Store search observations separately from opportunities: query, country, language, device, timestamp, rank, and provider. Show rank history only when multiple genuine observations exist.
3. Add a keyword-volume provider with provenance and observation dates. Retain null values if unavailable; do not derive traffic from arbitrary scores.
4. Extend website context extraction with reusable user-reviewed selectors and page-type rules; preserve private-network protection, content-size limits, and visible review before applying results.
5. Introduce a labeled evaluation dataset, original or appropriately licensed, covering relevant and irrelevant matches, common-word brands, mixed sentiment, and requests for alternatives.
6. Compare ranking precision and draft usefulness across local models. Record model and prompt changes so results can be reproduced.
7. Store rejection reasons and offer suggested filter changes for user review. Do not describe this as model training unless a real training process is implemented.

Exit criteria: documented source coverage, measured quality on the evaluation set, reliable deduplication, and an inspectable explanation for model-assisted decisions.

## Phase 3: reliable background operation and alerts

Move from a process-local timer to a durable job queue when multiple workers or hosted operation are required. Persist schedules, attempts, next run times, and last successful checkpoints. Implement bounded retries, rate-limit handling, jitter, cancellation, and idempotent jobs before increasing volume.

Add opt-in email and webhook delivery with destination validation, signed payloads, retry history, delivery status, and digest preferences. Differentiate collection cadence from notification cadence. Alert on meaningful new opportunities or connector failure; avoid repeated alerts for unchanged records.

Exit criteria: restarting during synchronization does not duplicate records or alerts; a failed provider can recover without losing state; users can pause jobs and understand remaining spend and quota.

## Phase 4: teams and remotely hosted deployments

Add authenticated accounts, invitations, roles, project ownership, scoped API tokens, and audit events. Separate token scopes for reading, drafting, and changing handled state. Add concurrency controls or optimistic locking for simultaneous editors. Test project isolation and access revocation before offering a shared hosted instance.

Introduce remote MCP only after establishing authentication, per-project authorization, resource limits, and a clear tool-permission model. Read-only remains the default. Mutating tools should be explicit about the affected project and team-visible consequences.

Provide backup and restore procedures, migration rollback planning, retention controls, health checks, and deployment documentation. Optional billing belongs in a distinct hosted-service layer; the open-source core should remain useful without subscription logic.

Exit criteria: one user's project cannot be accessed through another user's credentials; revoked tokens stop working; state changes are attributable; backup restoration is demonstrated.

## Phase 5: audience research and attribution

Expand beyond one-opportunity-at-a-time triage with saved audiences, community discovery, topic clustering, pain-point summaries, and source-grounded research reports. Every summarized pattern must retain links to evidence and distinguish a repeated observation from a single anecdote. Support multilingual content and allow abstention when context is insufficient.

Add optional user-configured campaign links and integrations with actual analytics or CRM events. Keep observed clicks, user-recorded conversions, and modeled estimates separate. A mention in a search-visible discussion is not proof that an AI assistant will cite the brand.

Exit criteria: reports are reproducible from their stored evidence, and measured outcomes can be traced to a real source rather than inferred from activity counts.

## Deliberate exclusions

GreenReach does not plan to reproduce bulk unsolicited DM campaigns, purchased-account networks, automated voting, deceptive endorsements, or anti-detection tactics. It should help users identify relevant public discussions and prepare honest contributions, with manual publishing and accurate recordkeeping.

A browser extension, private-message inbox sync, multi-platform collection, payment processing, and enterprise administration are separate product efforts. None should be implied by the presence of an opportunity pipeline or an integrations screen.

## Operating costs and release discipline

Plan for data-provider charges, model inference or local hardware, storage, email delivery, and maintenance. “Zero runtime npm dependencies” describes packaging; it does not mean zero operational dependencies or zero cost. Source-provider access must be confirmed for each intended deployment.

Each release should update the feature matrix, migrations, configuration examples, tests, connector coverage, and known limitations. Prefer a smaller verified workflow over screens whose buttons suggest capabilities that are not implemented. Publish source only after checking for credentials, private records, proprietary assets, and license compatibility.
