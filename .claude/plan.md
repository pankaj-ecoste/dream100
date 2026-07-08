# Dream 100 — plan.md

**Ecoste Group · Sales Intelligence Platform · Production Build Plan**

Build mode: AI-assisted development in VS Code · 7 focused hours/day, 6 days/week · Supabase managed Auth (no hand-written auth) · Next.js on Vercel · Claude API with web search.

This document supersedes all prior versions. Decisions marked **[LOCKED]** were confirmed in planning discussions and are not reopened without explicit change.

---

## 1. What this project is (in one paragraph)

A mobile-friendly web app that makes every Ecoste salesperson walk into every client meeting fully prepared in under 2 minutes. The salesperson searches a client; the app instantly shows everything already known from Zoho CRM (kept in sync automatically); on one tap, an AI agent researches the client live on the web and returns four bullet-point sections — LinkedIn-type people news, RERA, Website, Google News — followed by a combined analysis explaining how to approach the meeting. Follow-up questions are answered database-first. Findings are saved on consent; on the next visit the app shows the old picture instantly and the agent explains what has changed since.

The output feeds real sales meetings. A wrong fact damages a deal and destroys platform trust permanently. Accuracy guardrails (Section 13) are shipping requirements, not polish.

## 2. Realistic expectations — what this delivers, what it does not

### What V1 will genuinely deliver

- **The 20–40 minutes of pre-meeting research collapses into 2 minutes.** The CRM data (last meeting, contacts, stage, commitments, notes) shows instantly from Supabase — this alone is 60% of what a salesperson needs before a meeting, and it's rock-solid because it's just a database read.
- **Instant "what do we know" crux** on every account — no more opening five tools.
- **On-demand fresh research** with source links on every finding, streamed to the phone as the salesperson sits in the car.
- **A memory that Zoho doesn't have** — every stage change, every finding, every meeting outcome dated and preserved, so "what changed since last time" becomes a real feature.
- **Repeat-visit comparison** — when the same salesperson opens the same client next month, the agent shows the previous picture instantly and explains what's changed.
- **A CRM handler workflow** for draft accounts created from field meetings with unknown clients.

### What V1 will NOT deliver (honest expectations per source)

- **LinkedIn section will be the weakest.** LinkedIn does not sell an API for people-lookup and actively blocks scrapers. The section is fed by press coverage of hires/exits and public snippets from Google — meaning senior movements that made the news are caught; junior or unpublicized changes are missed. Expect ~40-60% coverage of what "full LinkedIn access" would give.
- **RERA section will be truthful but shallow.** For MahaRERA (Mumbai/Pune — your biggest markets), coverage is decent because pages are Google-indexed. For states with CAPTCHA or search-only portals (UP, Haryana, some others), coverage drops to whatever a Google search surfaces — typically just a few visible projects, not the complete promoter portfolio.
- **Website section will fail on JavaScript-heavy sites.** Modern React/Next.js single-page-application builder sites often return blank content to non-browser fetchers. When this happens, the section will honestly say "content unavailable" rather than fabricate.
- **News section is the strongest, but misses regional language coverage.** Hindi and vernacular news is often not surfaced by Google in English-language searches; specific regional press about a developer may be missed.
- **No proactive alerts** ("Rajiv Builders registered a new project last night — go look"). Alerts require the background sweep, which is V2 Phase B.
- **No follow-up notifications on login** ("you have 12 leads, you promised to reconnect with Sharma today"). This requires capturing intended next-contact dates in a meeting form loop we don't have in V1. V2 Phase A, first feature.
- **No dashboards for leadership** beyond the admin page's adoption + cost numbers. V2.
- **No WhatsApp integration.** V2.
- **No auto-updating of Zoho from the app** (write-back is deferred). V1 is read-only against Zoho; salespeople still update Zoho manually as they do today.

### What "success" actually looks like

If, at the end of the 5-week Phase 5 pilot, five salespeople across two cities say **"I open this before every meeting and I trust what it shows me"** — the platform has succeeded. If they say "the CRM part is great but the research is thin" — that's still success, because the research is upgradeable per source (Section 11) based on their specific complaints.

The failure mode we are engineering against: the platform shows a wrong fact confidently, a salesperson repeats it in a meeting, they get embarrassed, and the entire company stops trusting the tool. Every guardrail in Section 13 exists to prevent this.

---

## 3. Users

- **Primary — the salesperson (~100 people, 8 cities, on phones).** Everything designed for phone on mobile data in a car.
- **Secondary — the CRM handler.** Completes draft accounts the app creates from not-found flows.
- **Secondary — team leaders.** Same app, region-wide access via RLS, no separate screens in V1.
- **Later — leadership.** Dashboards are V2; V1 admin page gives adoption and cost numbers.

---

## 4. Data source strategy [LOCKED]

### 4.1 Where account data comes from

Zoho CRM only. Prospects and customers enter Supabase after a team leader has verified them into Zoho — the human quality gate is preserved. No Google Sheets sync in V1.

### 4.2 The Zoho → Supabase live sync

**Two triggers, one code path:**
- **Webhook** — Zoho workflow rule fires on create/edit, posts the record ID to our Vercel endpoint. Updates land in Supabase within ~5 seconds. Payload carries only the ID; endpoint fetches full record from Zoho API, guaranteeing we always store complete current truth.
- **Nightly cron at 11:00 PM IST** — Vercel scheduled function pulls records modified since last successful run. Heals gaps the webhook missed.
- **Weekly full reconciliation (Sunday)** — full ID sweep against Zoho's `/Accounts/deleted` endpoint to detect deletions; soft-archive (`archived_at`), never hard-delete.

Both call the same `upsertRecord()` function using `INSERT ... ON CONFLICT (crm_record_id) DO UPDATE`. Zoho permanent record ID is the unique key. Same Zoho record → same Supabase row, forever. Stage changes update the row in place.

### 4.3 Which records and which columns

**~2,000 records** (after filtering to active prospects and customers). Filter approach: **COQL in code, Custom View as design spec.** Zoho admin's existing Custom View is the human-readable specification; on Day 3 of Phase 1 we screen-share on the view, capture its exact filter criteria and custom field names, translate to COQL in `lib/zoho.ts`. Filter changes require a code deploy — deliberate, because every change is reviewed rather than happening silently.

Only fields listed in `ACCOUNT_FIELDS` are fetched (`?fields=` parameter). Everything else is ignored.

### 4.4 Bulk import

Day 3–4 of Phase 1: resumable one-time script run from a developer laptop (not Vercel, due to serverless timeout limits). Pages through filtered result set, upserts each record, stores last-completed page in `sync_state`. On crash, re-run resumes from last saved page. 2k records: 3–5 minutes.

### 4.5 The four research sources — honest picture

Direct source APIs for LinkedIn / RERA / news / websites do not usefully exist for our use case. All four sections fed by **Claude's web search tool** — one capability, four sections in the UI. No source-specific scrapers in V1. Realistic capability per source is in Section 2; upgrade triggers per source in Section 11.

---

## 5. Complete third-party stack

Every external service the system depends on, in setup order. Anything not on this list is not needed.

| Service | Purpose | Signup | Plan | Monthly cost |
|---|---|---|---|---|
| **Zoho CRM API** | Source of account data | Already have | Existing paid plan sufficient | Included |
| **Supabase** | Postgres + Auth + RLS | supabase.com | Free during build; **Pro before go-live** (daily backups + point-in-time recovery) | ₹0 / ~$25 |
| **Vercel** | Next.js hosting, webhook endpoint, cron | vercel.com | Free during build; **Pro before go-live** (better cron + timeouts) | ₹0 / ~$20 |
| **Anthropic API** | Claude + web search | console.anthropic.com | Pay-as-you-go with monthly budget alert | Est. ₹20k–45k at pilot scale (Section 12) |
| **Google Cloud OAuth** | For Supabase Auth Google sign-in | console.cloud.google.com | Free | ₹0 |
| **Domain (optional)** | Stable HTTPS URL for Zoho webhook | Any registrar | e.g. Namecheap | ~₹1,000/year — Vercel's free `.vercel.app` works otherwise |

### 5.1 Explicitly not needed in V1

- **LinkedIn API** — does not exist for people-lookup. Do not sign up for anything claiming to be one.
- **RERA API** — state portals don't offer APIs.
- **Google News API / SerpAPI / Bing Search API** — Claude web search covers news natively.
- **Website scraping service** (Firecrawl, ScrapingBee, Playwright) — Claude web search fetches pages directly in V1. Playwright is a V2 upgrade trigger (Section 11).
- **Vector database** (Pinecone, Weaviate, etc.) — retrieval per client is a plain SQL query. Vector search is a V2 knowledge-base feature.
- **WhatsApp Business API** — V2.
- **Licensed people-data vendor** (Apollo, Lusha, ZoomInfo) — deferred. Revisit only if pilot signals LinkedIn section is critically weak.
- **Agent frameworks** (LangChain, LlamaIndex, CrewAI) — deliberately not used. Direct Anthropic SDK calls give the prompt-level control accuracy stakes demand.

### 5.2 Where credentials go

Vercel environment variables only. Never in Git. `.env.example` in the repo names every var with a comment; actual values live only in Vercel env + one password manager entry per developer.

Required env vars: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

### 5.3 Application stack — finalized [LOCKED]

**One language, one codebase, one deployment: TypeScript on Next.js. There is no separate backend service — explicitly, no Python/FastAPI.**

| Layer | Technology | Version target |
|---|---|---|
| Framework | Next.js (App Router) | 15.x |
| Language | TypeScript (strict mode) | 5.x |
| Runtime | Node.js | 22 LTS (Vercel default) |
| Styling | Tailwind CSS, mobile-first | 4.x |
| AI SDK | `@anthropic-ai/sdk` (direct, no framework) | latest |
| Streaming bridge | `ai` (Vercel AI SDK) — Anthropic stream → browser SSE | latest |
| DB client | `@supabase/supabase-js` + `@supabase/ssr` (auth-aware server/browser clients) | latest |
| Validation | `zod` — webhook payloads, API route inputs | latest |
| Bulk import runner | `tsx` (dev dependency) — runs `scripts/bulk-import.ts` from laptop | latest |

**Why no FastAPI / Python backend (decision record):**

1. Every backend task is an I/O-bound serverless function (webhook upsert, nightly pull, one streamed Claude call, row writes). Nothing is compute-heavy or Python-ecosystem-dependent.
2. A second service means a second host, second deploy pipeline, CORS, duplicated secrets, and two runtimes for one developer. Direct conflict with the 30-day solo build constraint.
3. The hardest backend piece — streaming Claude to a phone — is a solved ~10-line problem in Next.js via the Vercel AI SDK. In FastAPI it's hand-rolled SSE plus a JS consumer anyway.
4. Authorization is enforced by Postgres RLS, not by an API middle tier. A proxy layer adds surface area without adding security.
5. The bulk import script is TypeScript too (`npx tsx scripts/bulk-import.ts`), reusing `lib/zoho.ts` so COQL/upsert logic exists exactly once.

**What "backend" concretely means in this architecture** (~30–35% of total code):

- 5 serverless API routes inside `app/api/` (webhook, nightly cron, chat orchestrator, findings save, draft account)
- 2 SQL migrations (6 tables, RLS policies, findings-archive trigger) — the database does authorization and history
- 6 lib modules; only `lib/zoho.ts` and `lib/agent.ts` touch external APIs
- 1 laptop-run bulk import script
- Vercel cron config in `vercel.json` (nightly 11 PM IST = `30 17 * * *` UTC; weekly reconciliation Sunday)

**Serverless constraints to design around (Vercel Pro):**

- Function max duration: set `maxDuration = 300` on `app/api/chat/route.ts` (research run target <90s, streaming keeps the connection alive) and on the nightly sync route. Webhook route stays default — it only fetches one Zoho record and upserts.
- Webhook must respond to Zoho fast: verify `ZOHO_WEBHOOK_SECRET`, validate payload with zod, fetch record, upsert, return 200 — no AI work ever on this path.
- Bulk import never runs on Vercel (timeout risk) — laptop script with resumable paging via `sync_state`, exactly as §4.4 specifies.

---

## 6. The agent — architecture [LOCKED]

### 6.1 One agent, not four

Single Claude API call with **parallel tool use**. Claude's API supports firing multiple tool calls in one response, so the four web-search queries run in parallel — same speed as separate agents. Then a single final analysis prompt processes all four raw findings together, producing qualitatively better analysis than compressed summaries fed to an aggregator.

Four sections in the UI ≠ four agents in code.

### 6.2 Stack

- **Endpoint**: Anthropic Messages API (`POST /v1/messages`) via `@anthropic-ai/sdk`
- **Model**: `claude-sonnet-5` — successor to the originally planned Sonnet 4.5 (now legacy). $3/$15 per MTok (introductory $2/$10 through Aug 2026). Near-Opus quality on agentic work. Escalation knob: `claude-opus-4-8` only if pilot analysis quality proves insufficient; cost knob: route LinkedIn/News section extraction through `claude-haiku-4-5` ($1/$5).
- **Adaptive thinking** (`thinking: {type: "adaptive"}` — replaces the old "extended thinking with budget_tokens" API, which is removed on current models and errors). Depth controlled per prompt via `output_config.effort`: `"high"` for FINAL_ANALYSIS and COMPARISON (the outputs that matter most), `"medium"` for section extraction and Q&A.
- **Tools**: `web_search_20260209` (server-side, built-in dynamic filtering — filters search results in a sandbox before they reach model context, cutting token cost), plus custom tools `get_account`, `get_interactions`, `get_saved_findings`, `save_findings`
- **Sampling params**: none — `temperature`/`top_p`/`top_k` are removed on current models (would 400). Output behavior is steered by prompts.
- **Streaming**: `client.messages.stream(...)`, delivered to browser via Vercel AI SDK (`ai` package) — the one library worth using because it handles Anthropic streaming → browser SSE with ~10 lines of code
- **Prompt caching**: `cache_control: {type: "ephemeral"}` breakpoint on the system prompt — two salespeople researching different clients the same hour still share the cached system prompt (~90% cheaper on the cached portion)
- **No vector DB**: retrieval per client is `SELECT ... WHERE account_id = $1`

### 6.3 The flow (as executed in `lib/agent.ts`)

```
1. Load client context: accounts row + latest N interactions + saved findings if any
2. Emit "From our existing data" crux (streamed to UI)
3. Wait for consent tap from user
4. Fire 4 parallel web_search tool calls (LinkedIn-type, RERA, Website, News)
   — each query enriched with Supabase context (city, industry) for identity
5. Stream each section as it completes → UI renders progressively
6. Identity check: does what we found match this account? If not, flag "verify"
7. Fire final analysis prompt (extended thinking) with all 4 raw findings + CRM
8. Enter Q&A loop: database tools first, web search only if DB is silent
9. On chat end: SaveDialog → save_findings tool writes client_findings row
```

### 6.4 Six quality techniques wired into V1 from day one

These are not enhancements — they are how you use Claude web search competently. All are cheap or free; skipping them delivers the "vague answer" outcome that would kill trust.

1. **Multiple targeted queries per section**, not one. RERA section fires `"{name}" MahaRERA`, `"{name}" project registration`, `"{name}" real estate promoter`. Costs a few cents extra per run, materially improves findings.
2. **Query enrichment from Supabase context.** Every query includes the city and industry we already know from CRM — `"Rajiv Builders" Pune real estate developer 2025` — dramatically reducing wrong-company matches and stale results.
3. **Date-scoped queries.** Adding the current year prioritizes recent results in Google's ranking.
4. **Reflection pass on the final analysis.** After initial findings, Claude reflects once: "given these findings, is anything material missing? If yes, one more search." ~15% cost premium, meaningful quality lift.
5. **Adaptive thinking at `effort: "high"` on the analysis and comparison prompts.** These are the outputs that matter; the cost premium is small and the quality difference is visible. (Sections and Q&A run at `"medium"`.)
6. **Aggressive caching.** Two salespeople researching the same client the same day: the second reads from cache. Free.

### 6.5 Prompts — specification, not text

**Actual prompt text lives in `lib/prompts.ts`**, versioned in Git, iterated during Phase 3 against real Zoho data. Nailing final wording now against imagined clients is planning theater.

What each prompt must enforce (the plan's contract — Phase 3 exit metrics verify these):

- **`OLD_DATA_SUMMARY`** — bullet crux of Supabase-known data. Headlined "From our existing data". <200 words.
- **`SECTION_LINKEDIN`** — people findings from web search. Bullets only, prominent items **bold**, every claim carries source link. Empty state: "No recent people updates found".
- **`SECTION_RERA`** — current projects and procurement stage. Bullets, bold, source links to portal pages. "No RERA presence found" if applicable.
- **`SECTION_WEBSITE`** — company website state, recent posts, projects. "Website not reachable" / "No notable updates" honest empties.
- **`SECTION_NEWS`** — 12-month press coverage: funding, awards, expansions, controversies.
- **`FINAL_ANALYSIS`** — combines CRM + all 4 sections. Produces: how to approach (2–3 lines), what to say (3–5 bullets), what to avoid (2–3 bullets), leverage points. Every point traces to a source.
- **`COMPARISON`** — consumes `diff.ts` mechanical output; narrates changes only. Cannot invent. "No changes since last visit" allowed.
- **`QA_SYSTEM`** — database tools first, web search only if DB silent, every answer cites source, refuses RLS-forbidden accounts.

### 6.6 Universal accuracy rules

- Every finding carries a source link — `format.ts` drops bullets without sources before rendering
- Uncertainty phrased as uncertainty ("reported by …", "as of …")
- "Nothing found" is a respected first-class output
- Identity check before findings render — mismatch shows "possible match — verify", not confident findings
- Comparison never invents — mechanical diff computes changes; LLM only narrates

---

## 7. Database schema — 6 tables [LOCKED]

| Table | Purpose | Key |
|---|---|---|
| `users` | Staff, roles, regions | Via Supabase Auth; drives RLS |
| `accounts` | One row per client, forever | `crm_record_id` UNIQUE; `lifecycle_stage`; `assigned_user_id`; `archived_at` |
| `interactions` | Meeting history, one row per Zoho note or CVR | `account_id` FK; `meeting_date`; newest = latest |
| `client_findings` | One row per client, updated in place | 4 finding columns + `final_analysis` + `updated_at` + `saved_by` |
| `findings_history` | Prior findings, auto-archived | Written by DB trigger on `client_findings` UPDATE; powers comparison + audit |
| `research_logs` | Every agent run | user, client, tokens, cost, duration, 👍/👎 |
| `sync_state` | Last successful sync per module | Advances only on success; enables resumable import |

**RLS applied before any data import.** Salesperson sees rows where `assigned_user_id = auth.uid()`. Team leader sees rows in region. Admin sees all. Background workers use service role and stamp `research_logs`. RLS is the security boundary.

---

## 8. Repository file structure (~20 files)

```
dream100/
├── supabase/migrations/
│   ├── 001_tables.sql          # the 6 tables
│   └── 002_rls_trigger.sql     # RLS policies + findings archive trigger
├── app/
│   ├── login/page.tsx          # Supabase Auth Google sign-in
│   ├── search/page.tsx         # entry: name/city/stage search
│   ├── client/[id]/page.tsx    # THE screen: record + timeline + chat
│   ├── prep/new/page.tsx       # not-found flow, ephemeral, draft option
│   ├── admin/page.tsx          # sync health, drafts, costs
│   └── api/
│       ├── zoho/webhook/route.ts   # verify secret → fetch record → upsert
│       ├── zoho/nightly/route.ts   # Vercel cron 11 PM IST → same upsert
│       ├── chat/route.ts           # agent orchestrator, streaming
│       ├── findings/save/route.ts  # upsert client_findings (trigger archives)
│       └── accounts/draft/route.ts # create flagged draft account
├── lib/
│   ├── zoho.ts                 # OAuth refresh + upsertRecord + ACCOUNT_FIELDS
│   │                           #   + COQL query builder
│   ├── agent.ts                # Claude call, parallel tools, streaming,
│   │                           #   research_logs writes, reflection pass
│   ├── prompts.ts              # all 8 prompts, versioned
│   ├── diff.ts                 # stored vs fresh findings mechanical diff
│   ├── format.ts               # bullet enforcement, source-link check,
│   │                           #   drop bullets without sources
│   └── supabase.ts             # browser + server clients (@supabase/ssr)
├── scripts/
│   └── bulk-import.ts          # one-time resumable import, run via npx tsx
│                               #   from laptop — never on Vercel
├── vercel.json                 # cron: nightly 17:30 UTC (11 PM IST),
│                               #   weekly reconciliation Sunday
├── .env.example                # every env var named + commented, no values
└── components/
    ├── SearchBar.tsx
    ├── ClientRecord.tsx        # CRM row + "synced HH:MM" freshness stamp
    ├── Timeline.tsx            # interactions, newest first
    ├── Chat.tsx                # streaming conversation UI
    ├── FindingsSection.tsx     # bullets, bold, source links, empty state
    ├── DiffView.tsx            # comparison on repeat visits
    ├── SaveDialog.tsx          # save? yes/no + draft account
    └── FeedbackButtons.tsx     # 👍👎 on every analysis → research_logs
```

Rule the structure encodes: the app never talks to Zoho or Claude directly. `lib/zoho.ts` and `lib/agent.ts` are the only files touching external APIs.

---

## 9. Phase-by-phase build with timeline

7 focused hours/day, 6 days/week (Monday–Saturday). Total: **~30 working days ≈ 5 weeks calendar time** including a 1-week pilot at the end.

### Phase 0 — Foundation (Days 1–3)

Supabase project (Mumbai region), migrations 001–002 applied, Supabase Auth + Google OAuth wired (2 hours with Google Cloud Console — one of the fiddlier steps), roles seeded, Vercel project + domain live, all env vars populated. In parallel: Zoho admin drafts workflow webhook rules pointed at eventual endpoint URL.

**Exit metrics**
- Test salesperson login sees only assigned seed accounts (RLS proof)
- Test manager sees only their region
- Deploy pipeline green
- Hello-world cron job runs and logs to `research_logs` with cost 0

### Phase 1 — Zoho sync (Days 4–8)

**Day 4 morning: field-mapping screen-share** with Zoho admin. Capture Custom View filter criteria, exact custom field names, stage values. This is the one meeting that unblocks everything else.

Days 4–8: `lib/zoho.ts` complete (token refresh with alert-on-failure, COQL query builder, `upsertRecord`); webhook endpoint deployed and Zoho workflow rules pointed at it; nightly cron scheduled; resumable bulk import script written and run for ~2k records; notes → interactions; admin sync-health page.

**Exit metrics**
- Edit a stage in Zoho → same Supabase row updated <60 seconds
- Create a Zoho account matching the filter → appears exactly once, verified across 3 nights, zero duplicates
- Bulk import completes with per-record success report
- Webhook disabled for 24 hours → nightly heals to 100% parity on a sample

### Phase 2 — Search + client screen (Days 9–12)

Search page, `ClientRecord` with freshness stamp, `Timeline` component, mobile-first layout tested on real phones, admin page skeleton. No AI yet — proves the mirror beats opening Zoho.

**Exit metrics**
- On real phone on 4G: cold open → search → full record **<3 seconds**
- P95 search-to-record **<1.5 seconds**
- 2 pilot salespeople confirm record content matches Zoho reality

### Phase 3 — Agent, first visit (Days 13–20)

The heart of the product. Chat route with streaming; `OldDataCard` rendering the crux <3s; consent tap; parallel web-search tool calls with all six quality techniques from Section 6.4; four sections per prompt spec; `FINAL_ANALYSIS` with extended thinking; Q&A loop; `SaveDialog` → `client_findings` written; not-found flow with draft-account option; `research_logs` capturing cost per run; `FeedbackButtons` wired.

**Exit metrics**
- Full research completes **<90 seconds**, streamed progressively
- 4/4 sections either populated with source links or honestly empty across 10 test clients
- At least one section is genuinely empty for at least one test client (proves prompts respect honest empties)
- Q&A question about last meeting cites the actual latest interaction row (not fabricated)
- Asking about a non-assigned account is refused (RLS proof)
- Cost per run visible in admin; average within budget target

### Phase 4 — Repeat visit + comparison (Days 21–24)

Stored picture renders instantly before any research; re-run; `diff.ts` computes changed vs unchanged mechanically; `DiffView` + `COMPARISON` prompt (extended thinking) narrates the diff; save updates same row, trigger archives.

**Exit metrics**
- Repeat visit shows stored picture **<2 seconds**
- Seeded change between visits is named in the diff with a preparation implication
- **Zero hallucinated changes across 10 unchanged-client repeats** (hard gate)
- After save, `client_findings` has latest values, `findings_history` gained exactly one row

### Phase 5 — Pilot and hardening (Days 25–30)

Five salespeople across two cities use the platform on real meetings for one week. Daily 15-minute feedback call. Accuracy protocol (Section 13) runs on every research output of first 3 days. Fixes ship daily. Full rollout only when exit metrics pass.

**Exit metrics**
- Prep time **<2 minutes** measured in real car test
- **≥80% 👍 rate** on final analyses
- **Zero confirmed false facts** in final 3 pilot days
- **≥60% save rate** on research runs (below this = investigate prompt quality)
- ≤2 support requests per day per pilot user

**If exit metrics fail**: do not roll out. Extend pilot by 3–7 days for prompt tuning against real usage. Then re-test. This gate is non-negotiable.

### Rollout to full 100-user team (Days 31–33)

Assuming Phase 5 passes: onboard the remaining ~95 users in staggered groups (region by region). Two-day support burst. Then steady-state ops.

---

## 10. Deferred features — V2 roadmap

Deliberately not in V1. Ordered by expected priority based on pilot feedback.

### V2 Phase A — Follow-up notifications (2 weeks, immediately after V1)

The "when a salesperson logs in, show them their leads and last-contact dates" feature. Requires:
- Data foundation: an "intended next contact date" field must be captured somewhere. The cleanest place is a light post-meeting quick-form the salesperson fills after each meeting (this also starts capturing structured meeting outcomes for future write-back).
- Notification rendering layer on login and in a dedicated "My leads" tab.
- Dismissal logic (marked contacted, snooze, etc.).

**Why it's V2, not V1**: the data to power it doesn't exist reliably yet. Building the notification UI on top of missing data delivers a half-empty feature that erodes trust. V2 Phase A builds the data capture first, then the notifications on top.

### V2 Phase B — Proactive alerts (2–3 weeks)

Background priority sweep for Dream 100 + recently-active accounts (~300–500). Weekly cheap checks (RERA state sweeps, news RSS, page hash) → in-app alerts: "Rajiv Builders registered a new project", "no contact 60 days on X account". Independent of Phase A but same infrastructure.

### V2 Phase C — Source-specific upgrades based on pilot feedback

Triggered only by pilot data, not built speculatively:
- **MahaRERA Playwright scraper** (~2 weeks) if pilots say RERA section is critically thin. Covers ~60% of Dream 100 by geography. Only Maha — do not build 8 state scrapers speculatively.
- **Apollo Basic subscription** (~$59/month for one platform seat) if pilots say LinkedIn section is missing critical people data. One seat used by the platform, not per-user.
- **Website Playwright fetcher** (~1 week) if JavaScript-heavy sites are a common failure.

### V2 Phase D — Leadership dashboards + WhatsApp digests (3 weeks)

Region → salesperson → account drill-down; adoption metrics; opportunity/relationship/data-quality scores with factor breakdowns; morning WhatsApp digest via BSP (Gupshup/Interakt/Twilio). BSP registration + Meta template approval has 2–3 weeks of lead time — start that process during V1 pilot if V2 Phase D is imminent.

### V2 Phase E — Write-back to Zoho + in-app meeting form (2 weeks)

Post-meeting form inside the app; extraction into structured MoM + commitments; approved outbox writing notes + tasks to Zoho. Closes the loop between the app and the CRM in both directions.

### V2 Phase F — Knowledge base + RAG (3 weeks)

Product docs, case studies, past meeting notes across all accounts embedded into pgvector. Q&A gains "find me a similar deal we won" precedent lookup. Only worth building after V1 has been running long enough to accumulate meeting data worth searching.

---

## 11. Upgrade triggers (when to invest in V2)

Every V2 phase has a **pilot-signal trigger** — build only if real usage demands it:

| V2 phase | Trigger from pilot |
|---|---|
| A — Follow-up notifications | Explicit request from ≥3/5 pilots ("I forget which leads to reconnect with") |
| B — Proactive alerts | Instances of missed opportunities discovered post-hoc (competitor won a project we didn't know had been registered) |
| C1 — MahaRERA scraper | ≥40% of Maha pilot research sessions rate RERA section 👎 |
| C2 — Apollo subscription | ≥40% of research sessions rate LinkedIn section 👎 |
| C3 — Playwright websites | ≥25% of website sections return "content unavailable" |
| D — Dashboards + WhatsApp | Leadership explicitly requests reporting; adoption ≥70% team-wide |
| E — Write-back | Salespeople complain about "still updating Zoho manually after using the app" |
| F — Knowledge base | Enough meetings logged to make RAG results non-empty (≥6 months of usage) |

---

## 12. Cost envelope

**Fixed monthly at go-live**: Supabase Pro ~$25 + Vercel Pro ~$20 ≈ ₹3,750.

**Variable — Anthropic API**: dominant cost.
- **Development cost during 5-week build**: est. ₹8,000–15,000 for prompt iteration and testing
- **Pilot cost (5 users, 1 week)**: est. ₹3,000–6,000
- **Steady-state at full 100-user rollout**: ~200 research runs/day × ~30 days = ~6,000 runs/month → **est. ₹25,000–50,000/month** using Claude Sonnet 5 with high-effort adaptive thinking on the analysis prompts — likely toward the low end while introductory pricing ($2/$10 per MTok through Aug 2026) applies and thanks to web search dynamic filtering trimming result tokens
- **Cost knobs if numbers exceed target**: (a) drop the comparison prompt from `effort: "high"` to `"medium"` — cuts that cost with minor quality impact; (b) route section extraction (LinkedIn, News) through `claude-haiku-4-5`, keep Sonnet only for final analysis — cuts total ~35%; (c) reduce reflection pass frequency; (d) verify prompt-cache hit rate weekly (`usage.cache_read_input_tokens` in `research_logs`) — a broken cache silently multiplies input cost

**Cost controls from day one**
- Every run logged in `research_logs` with token counts and estimated cost
- Monthly Anthropic budget alert configured at deploy time
- Weekly cost review from `research_logs` during pilot and first month
- On-demand research means cost tracks meetings, never account count

**Domain**: ~₹1,000/year, one-time.

---

## 13. Accuracy and trust guardrails

Output feeds real client meetings. Every guardrail below is a shipping requirement.

- **Source link on every finding.** `format.ts` drops bullets without source links before rendering. Enforced by prompts (require citations) and code (validate on receive).
- **Uncertainty worded as uncertainty.** Prompts require "reported by [source]" framing for single-source claims. Inference never presented as fact.
- **"Nothing found" is a respected answer.** Prompts explicitly reward honest empties. Phase 3 pilot verifies: at least one test client must have a genuinely empty section. If everything is always populated, the prompts are too lenient.
- **Comparison narrates code-computed diffs.** `diff.ts` computes what changed mechanically; LLM only writes narration. Phase 4 zero-invention gate.
- **Identity check before findings render.** Agent's first act after research is confirming the *right* company (name + city match against CRM). Mismatch shows "possible match — please verify". Wrong-company research is the single most damaging failure mode.
- **Feedback wired from day one.** 👍/👎 on every analysis lands in `research_logs`. Falling ratio is the earliest alarm of prompt drift. Weekly review.
- **Sync failure alerts loudly.** Dead Zoho refresh token or failed nightly run emails admin same night. Stale data presented as fresh kills trust.
- **Pilot before rollout.** Five users, one week, accuracy protocol on all research outputs. Full rollout inherits verified trust.

---

## 14. Do-first checklist (before Phase 0 code)

1. Zoho admin creates Self Client at api-console.zoho.com — ✅ done
2. Refresh token generated and saved — ✅ done
3. Zoho workflow webhook rules drafted (not yet pointed at endpoint URL)
4. Supabase project created (Mumbai region), password saved
5. Vercel account exists (GitHub sign-in)
6. Anthropic API account with payment method, key generated
7. Google Cloud project for OAuth client (Supabase Auth needs this) — ~30 minutes
8. Domain reserved (or accept `.vercel.app` for now)
9. Day-4 field-mapping screen-share booked with Zoho admin
10. Five pilot salespeople identified and told they're first

---

## 15. Operational basics

Secrets only in Vercel env. Supabase Pro (daily backups + point-in-time recovery) from go-live day — this data becomes the company's sales memory. Soft-delete only. Weekly cost review from `research_logs`. On-call rotation for the first two weeks after full rollout (someone watching sync health and 👍/👎 ratio daily).

---

## 16. Outcome scoreboard (measured from pilot onward)

- Prep time **<2 minutes** (the car test)
- Searches per salesperson per week **≥ their meeting count**
- % of meetings preceded by a research run (adoption depth)
- Save rate on research runs **≥60%** — below = investigate prompts
- 👍 rate on analyses **≥80%**
- Sync freshness **~100%** of accounts touched in last 24h
- Cost per research run within ceiling; monthly Anthropic spend tracked vs target

---

## 17. The test that overrides everything

A salesperson in a car, 10 minutes before a meeting, on mobile data: search → old picture instantly → fresh findings streamed with sources → "here's how to approach this meeting" — **under 2 minutes, and nothing on that screen is wrong.**

Every phase gate, every guardrail, every technique in Section 6.4 exists to make both halves of that sentence true. If a proposed feature doesn't serve it, it waits for V2.
