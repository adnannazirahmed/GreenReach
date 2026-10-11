# Redreach and the community intelligence market

Research date: **October 10, 2026 (America/New_York)**. Prepared for GreenReach, an independently implemented, open-source alternative.

This is a detailed study of publicly accessible product pages and documentation, not access to proprietary source code, production systems, customer accounts, or model weights. Descriptions below are vendor claims unless explicitly labeled as our analysis. Features and prices can change; older help articles sometimes conflict with current product pages. No vendor's revenue, conversion, coverage, or accuracy claims were independently benchmarked.

## Product model

Redreach sells a workflow for turning relevant Reddit discussions into opportunities: provide business context, discover conversations, decide whether engagement is useful, draft a response, manually engage, then track the result. Its distinctive positioning combines search visibility with fresh conversations and competitor monitoring. The homepage also markets outbound DM automation as a separate capability. GreenReach should reproduce the useful workflow in original software, with its own identity and implementation. [Redreach product](https://redreach.ai/)

Our analysis: the valuable unit is an **explainable opportunity**, not a generated comment. A useful record answers: where was it found, what problem is being discussed, why does this business fit, how current is the evidence, what has already happened, and what should the user do next?

## Redreach feature study

### 1. Onboarding and business context

The setup guide asks for a website and up to three initial competitor domains. It recommends a specific company description and says the first discovery pass takes roughly five to eight minutes after subscription. Competitors supply monitoring targets and alternative-product opportunities. The guide describes competitor changes as limited to twice monthly; this is a commercial constraint, not an inherent technical requirement. [Setup guide](https://help.redreach.ai/getting-started/44NmqDS5g8BARncLuKPdo1/getting-started-with-redreach-complete-setup-guide/44NmqDS5g848CqTFqn9CHM)

**GreenReach design implication:** capture editable project identity, description, keywords, competitors, and exclusions. Do not silently assume a domain fully describes a business. Website extraction and keyword suggestions should preserve human review. Multiple projects need separate queues and state.

### 2. Searchbox: opportunities already visible in search

Searchbox documentation describes discovering Reddit threads in Google's top five results for related terms. Cards expose the discussion, subreddit, matching queries, estimated monthly search volume, and business relevance. Its views distinguish all results, high-intent queries, own keywords, and competitor keywords. Older discussions can remain valuable if they still appear in search. The article also makes stronger SEO and AI-training claims that are not established by the presence of a ranking alone. [Searchbox guide](https://help.redreach.ai/using-redreach-inbound/44NmqDS5g99v7wihXd1dLa/searchbox-find-reddit-posts-ranking-on-google/44NmqDS5g7nSLA4KxTj9Lb)

**GreenReach design implication:** keep query, observed position, location, provider, and observation time together. A Reddit-restricted search position is not the same as its position in an unrestricted Google search. Never invent volume when the provider does not return it. A search result is evidence of visibility at a particular time, not evidence of visits, leads, or future model citations.

### 3. Fresh opportunities

Redreach's fresh-conversation feed targets keyword matches less than a day or week old. The help article describes daily or weekly refreshes depending on plan, a next-update countdown, keyword provenance, post age, subreddit, and engagement. This workflow optimizes for joining a developing discussion; Searchbox optimizes for existing search visibility. The article's timing recommendations are advice, not universal conversion evidence. [New Opportunities guide](https://help.redreach.ai/using-redreach-inbound/44NmqDS5g99v7wihXd1dLa/new-opportunities-be-first-in-fresh-reddit-conversations/5E1DaJeaNhpnCUPjkyjE7c)

**GreenReach design implication:** separate the source publication time from first discovery and last synchronization. Missing publication dates should remain unknown. Provide explicit sync failures and last-success timestamps so an empty feed is not confused with successful exhaustive monitoring.

### 4. AI filtering and relevance

The filtering guide identifies three main controls: company description, custom keywords, and ignored subreddits. It recommends describing the audience and problem concretely, excluding consistently irrelevant communities, and reviewing rejected results. It does not disclose the production model, prompts, embedding method, score calibration, or an evaluated accuracy rate. [Filtering guide](https://help.redreach.ai/using-redreach-inbound/44NmqDS5g99v7wihXd1dLa/how-to-optimize-reddit-post-filtering-with-ai/5E1DaJeaNiJ6DMHndcfHG4)

**GreenReach design implication:** use visible deterministic filtering before optional model reasoning. Keep a reason alongside every score, label whether it came from rules or a model, and let the user override it. A 0–100 ranking score should not be presented as a probability of purchase. Rejected items should remain inspectable to expose false negatives.

### 5. Brand and competitor mentions

Redreach documents monitoring names, domains, spelling variations, and competitor terms in posts and comments. Mention records include triggering terms, context, engagement, age, and sentiment reasoning. Its interface separates the user's company from individual competitors and summarizes positive, neutral, or negative sentiment. The documentation's language about finding every mention is a coverage claim, not independently verified completeness. [Mentions guide](https://help.redreach.ai/using-redreach-inbound/44NmqDS5g99v7wihXd1dLa/mentions-track-brand-mentions-and-competitor-discussions/5E1DaJeaNkzcDAiFUxi8zH)

**GreenReach design implication:** distinguish brand detection from sentiment toward that brand. A frustrated post can praise the product. An OAuth submission search integration does not establish site-wide comment monitoring. Display the actual coverage of each connector and preserve source URLs for inspection.

### 6. Reply generation and posting

The inbound workflow generates a suggested comment from a selected opportunity, allows editing, copies it, and opens Reddit. The human posts it. The guide explicitly says inbound comments are not automatically published. It supports saved templates and one-off instructions. Manual publication remains a separate event from generation or copying. [AI reply guide](https://help.redreach.ai/using-redreach-inbound/44NmqDS5g99v7wihXd1dLa/using-ai-reply-suggestions-to-promote-your-product/5EUyPSHwFRPX5Xep68dyV1)

The prompt settings guide names three starting templates: Engaging, Direct, and Balanced. Users can add templates that specify role, context, response requirements, and tone. Custom prompts guide generation; they are not evidence of fine-tuning or training a unique model for each customer. [Prompt customization](https://help.redreach.ai/settings--configuration/44NmqDS5g8DGSJGcWAzGpj/customizing-ai-comment-suggestions-and-prompts/5E1DaJeaNjGX4KMxfrm1tK)

**GreenReach design implication:** retain editable drafts; separate ready, copied, and manually published states. Ask the model to address the actual question, disclose affiliation when mentioning the product, and avoid invented first-person experience. A unavailable model should produce a clear status or explicitly labeled template, never a pretend AI response.

### 7. Queue, archive, and insights

Redreach describes active, replied, and rejected interaction states. Users mark a discussion replied after posting manually; this removes it from the active feed and adds it to history. Rejecting also removes it from the queue. The documentation claims feedback improves later suggestions but does not reveal the underlying learning mechanism. [Interaction and archive guide](https://help.redreach.ai/using-redreach-inbound/44NmqDS5g99v7wihXd1dLa/managing-your-post-interactions-and-archive/5E1DaJeaNeAQsaSq5LEJ5r)

Its Insights guide describes replied-post counts, estimated impressions derived from search volume, recent reply history, and subreddit ranking. Listed ranking inputs include keyword frequency, discussion engagement, business context, and competitor activity. These are descriptive inputs, not a published reproducible formula. Estimated impressions must not be interpreted as measured comment views. [Insights guide](https://help.redreach.ai/using-redreach-inbound/44NmqDS5g99v7wihXd1dLa/insights-understand-your-reddit-marketing-performance/5E1DaJeaNisBfveHUPPmEP)

**GreenReach design implication:** report observable activity first: imported items, saved opportunities, drafts, user-recorded publication, pipeline counts, and source mix. Revenue and conversions require actual attribution or user-entered outcomes; discovery counts alone cannot support them.

### 8. Outbound and CRM

The outbound documentation describes a Chrome extension with thread campaigns, subreddit campaigns, message personalization, and outreach tracking. Its index describes list campaigns in future tense, so availability should not be assumed solely from the navigation. This is a separate workflow from inbound comments. [Outbound documentation](https://help.redreach.ai/using-redreach-outbound/6bs6wGRq1NpGAxVfUa9V1W)

The CRM guide says extension leads synchronize to the web product. It describes username, originating account, campaign, subreddit, discovery source, message, tags, dates, response flags, and an interaction timeline. The listed funnel runs from sent outreach through interest and booked meetings to won or lost. Filters cover campaign, status, response, and date; statistics include leads, response rate, wins, and daily message usage. [CRM guide](https://help.redreach.ai/using-redreach-outbound/6bs6wGRq1NpGAxVfUa9V1W/tracking--managing-your-outreach/6bs6wGRq1RJZAnM1q3QGma)

**GreenReach design implication:** build a manual opportunity pipeline with notes and outcomes. Bulk DM sending, purchased accounts, account networks, and attempts to evade platform limits are outside this project's implementation scope. A manual pipeline is useful without pretending it duplicates the extension or private inbox synchronization.

### 9. REST API and MCP

The public API page describes bearer tokens and paginated JSON under `https://connect.redreach.ai/api/v1`. Resources cover projects, fresh and search opportunities, indexed threads, keywords, mentions, subreddit insights, reply context, handled threads, leads, lists, campaigns, and CRM insights. Its handled endpoint records replied or ignored status. Published quotas are 120 requests/minute and 2,000/hour per key, with rate-limit headers and retry information. The page says API access is included with Growth, Professional, and Agency plans. [API reference](https://redreach.ai/reddit-api)

The MCP documentation explains that an external assistant can use project information and thread context to draft responses and query reports. It lists tools for opportunities, mentions, communities, and CRM data; team-wide handled state prevents duplicate work. The assistant's own model can perform synthesis over fetched data. [Assistant workflows](https://help.redreach.ai/integrations/8xSAZaUGr79fNwzNkLrG7J/what-you-can-ask-redreach-in-your-ai-assistant/8xSAZaUGr6Kdy1Y3QKcUTB)

Connection permissions inherit the user’s project visibility. The permissions guide says the assistant cannot post, vote, send Reddit DMs, change billing, delete records, or manage credentials; it can change handled status. The connection only exposes data indexed for the user's projects. It also notes that retrieved information is shared with the chosen assistant provider. These restrictions describe the integration, not the separate outbound extension. [Connection permissions](https://help.redreach.ai/integrations/8xSAZaUGr79fNwzNkLrG7J/permissions-security-and-managing-connections/8xSAZaUGr5A9Y2frSZR2rA)

**GreenReach design implication:** start with a read-only local stdio MCP adapter over the same database as the app. Do not expose raw unrestricted SQL. API or MCP availability does not itself grant access to arbitrary Reddit content.

### 10. Teams, billing, alerts, and documentation drift

The Redreach homepage describes Startup, Growth, and Professional plans with one, two, and three seats respectively, including the owner. Larger agencies and teams use custom arrangements. Exact current subscription dollar amounts were not reliably present in the extracted pricing section, so none are asserted here. [Product and pricing FAQ](https://redreach.ai/)

Account help covers subscription changes, cancellation or pausing, VAT details, invoices, discount codes, and account credentials. This establishes the existence of billing administration; it does not reveal payment implementation or business economics. [Account and billing documentation](https://help.redreach.ai/account--billing/44NmqDS5g7z5uiu93mxPgV)

The August 2025 notification guide describes daily or weekly fetch intervals, plan restrictions, email delivery, and future Slack/Telegram support. The current alerts product page advertises Email, Telegram, Slack, and webhooks. Treat the older help article as historical where the pages conflict, and verify paid behavior before promising integration parity. [Notification guide](https://help.redreach.ai/settings--configuration/44NmqDS5g8DGSJGcWAzGpj/managing-your-redreach-notification-settings/5EUyPSHwFSN4C4sQBpnZNc), [current alerts page](https://redreach.ai/alerts/reddit)

## Competitors and their AI workflows

Prices below are the observed public offers, not quotes or a recommendation to buy. Annual billing is explicitly labeled. Comparisons assess documented workflow, not independently measured quality.

| Product | Main workflow and documented AI use | Pricing evidence and differentiation |
| --- | --- | --- |
| **Octolens** | Collects mentions across social, developer, media, and other sources; applies business-context relevance, intent, sentiment, and language labels; routes results to tools. | Pro lists $159/month billed annually, Scale $499/month billed annually, and custom Enterprise. API, MCP, and webhooks are advertised across plans. Broader listening and routing than a Reddit-only reply queue. [Product](https://octolens.com/), [intelligence pipeline](https://octolens.com/product) |
| **Syften** | Precise keyword/source rules first, then optional per-filter AI acceptance rules. Users inspect accepted and rejected examples; API exposes verdicts. | Entry $29.95/month; Standard $49.95/month with AI filtering; Pro $119.95/month with MCP and webhooks. Some networks cost extra. It emphasizes explicit matching and fast actionable alerts. [Plans](https://syften.com/), [AI workflow](https://syften.com/ai-social-listening) |
| **F5Bot** | Monitors Reddit, Hacker News, and Lobsters; starts with keyword alerts and offers natural-language AI filtering on paid tiers. | Free tier is labeled personal-use only with limits; Silver $9.99/month; Gold $49.99/month includes AI filtering; Platinum $214.99/month includes API/webhooks. Calling all F5Bot functionality “free keyword-only” is outdated. [Product](https://f5bot.com/), [tier details](https://f5bot.com/tiers) |
| **KWatch** | Keyword monitoring plus tracking replies inside selected conversations. AI analyzes context and sentiment. Alerts cover email, Slack, and webhooks according to plan. | Free limited monitoring; Essential $19/month includes AI; Business $79/month adds API/webhooks/Slack/MCP and teams; Enterprise $199/month. Its displayed channels include Reddit, HN, X, LinkedIn, Facebook, and YouTube. [Product and plans](https://kwatch.io/) |
| **ReplyGuy** | Suggests keywords, selects recent relevant discussions, and generates product-related replies. Paid plans advertise auto-replies; its FAQ says Reddit replies use purchased accounts, while Twitter replies are posted by users. | Analyst $39/month excludes auto-replies; Pro $49/month lists 100 replies; Business $99/month lists 300; higher tiers scale volume. We do not adopt its purchased-account distribution model. [Workflow, plans, and FAQ](https://replyguy.com/) |
| **GummySearch** | Historical audience research: discover communities, organize audiences, search conversations, and surface pain points, requests, alternatives, and content ideas. Its product page describes search and summarization but does not expose model internals. | **Closed to new business November 30, 2025.** Its closure notice allows limited continuing access for prior purchasers, with lifetime customers through November 30, 2026. It is a historical design reference, not a current new-account option. [Historical product](https://gummysearch.com/product/), [closure notice](https://gummysearch.com/closing-time/) |

Octolens also documents a 23-tool MCP surface with both reads and writes: mention queries and analytics alongside keyword, feed, and destination management. That integration is broader than a read-only initial adapter. Our inference is that interoperable structured data has become an important competitive feature independent of the dashboard. [Octolens MCP](https://octolens.com/mcp)

### What “uses AI” means in this market

The observed products separate into several functional stages. The following is our synthesis of the evidence above, not a claim that vendors share an implementation:

1. **Context preparation:** turn a business description into search concepts, synonyms, competitor entities, and exclusions.
2. **Retrieval:** obtain candidate content using keyword rules, search engines, platform APIs, or licensed collection. Retrieval is not necessarily AI.
3. **Classification:** decide whether a match is about the intended company, identify a request or complaint, and assign sentiment or intent.
4. **Prioritization:** combine relevance with freshness, source visibility, and previous handling. Scoring is not a conversion forecast.
5. **Generation:** produce a draft or summary using project information and retrieved content.
6. **Workflow integration:** allow another assistant to retrieve structured data through an API or MCP and apply its own model.

The sources reviewed do **not** establish vendors' production model versions, system prompts, private datasets, fine-tuning procedures, evaluation sets, inference cost, unit economics, exact crawl contracts, or complete infrastructure. In particular, a context-aware reply does not prove custom model training. A keyword filter plus an LLM classifier is a plausible independent design; it is not a verified reconstruction of Redreach.

## Recommended independent architecture

These are GreenReach engineering decisions, not facts about competitor backends.

Use Node.js 24 with native HTTP, fetch, and SQLite support; keep the first frontend plain HTML/CSS/JavaScript and require no runtime npm dependencies. SQLite is suitable for a small self-hosted service with bounded queries, durable state, and straightforward backups. Pin the supported Node major and test against its API instead of following newer runtime examples blindly. [Node 24 SQLite reference](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)

Use independent source adapters: authorized Reddit OAuth submission search for fresh opportunities, SerpAPI organic results for observed Google rankings, and user-provided imports. Reddit documents search and discussion endpoints; a submission-search adapter alone cannot claim full comment monitoring. SerpAPI provides organic result fields such as position, link, title, and snippet; monthly keyword demand needs a separate trusted source. [Reddit API reference](https://www.reddit.com/dev/api/), [SerpAPI organic results](https://serpapi.com/organic-results)

Use Ollama as an optional local inference provider for classification and drafting. Its chat API and structured-output support permit a schema-constrained result, but application-side validation remains necessary. Keep provider, model, prompt version, input provenance, and whether a fallback ran visible in the data model. [Ollama chat](https://docs.ollama.com/api/chat), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs)

Recommended internal responsibilities:

| Layer | Responsibility | Failure behavior |
| --- | --- | --- |
| Project configuration | Context, monitored terms, competitors, exclusions, preferences | Validate before saving; preserve previous valid state |
| Source adapters | Fetch bounded records with provenance and timestamps | Show source-specific errors; do not substitute fabricated live data |
| Normalization | Canonical URLs, deduplication, missing values | Preserve unknowns and imported provenance |
| Ranking | Deterministic baseline and optional model refinement | Explain the score and label the method |
| Drafts | Editable suggestions grounded in available context | Distinguish generated text, template text, and human edits |
| Pipeline | User-recorded stage and notes | Preserve state across source refreshes |
| Analytics | Counts and outcomes from stored events | Do not invent traffic or revenue |
| Scheduler | Bounded recurring synchronization while running | Prevent overlap; record partial failures and last success |
| API/MCP | Structured access to the same stored records | Validate identifiers and limits; keep initial MCP read-only |

### Data access is a product dependency

Reddit's current access guidance says eligibility and approval depend on the submitted app and use case, and model training requires explicit consent. Open-source code is not a grant of platform access. Build import and demo paths so users can evaluate the software without claiming live coverage. Operators must arrange appropriate access for their actual deployment. GummySearch's closure is a concrete reminder that platform dependency can determine a product's availability. [Reddit developer access guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data), [GummySearch closure](https://gummysearch.com/closing-time/)

## Success criteria and open questions

A credible first version should let a user configure a project, ingest real or explicitly synthetic records, see why items rank, prepare and edit a useful draft, record their own engagement, and recover all state after restarting. The workflow must remain usable without paid credentials, while clearly indicating what connectors are inactive.

Measure retrieval precision on a labeled sample, false-negative rates on reviewed rejected items, source freshness, duplicate rate, time to triage, draft editing effort, and user-recorded outcomes. Use separate evaluation sets for ambiguous brand names, sarcastic sentiment, competitor comparisons, and missing context. Compare a simple baseline with model-assisted ranking before accepting model cost and latency.

Open questions for later releases include licensed comment-level monitoring, reliable keyword-volume acquisition, complete thread context, deletion reconciliation, multilingual evaluation, background operation when the app is closed, team permissions, alert delivery, and measured attribution. The roadmap deliberately separates these from the first implementation. None of the research supports a guarantee of Google rankings, AI-answer inclusion, leads, sales, or immunity from community moderation.
