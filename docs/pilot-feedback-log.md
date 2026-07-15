# Dream 100 — Pilot Feedback Log

**Purpose:** capture every "the app got this wrong / this section was thin" complaint from a
real salesperson, in enough detail that it points straight at the prompt to fix. Prompt
improvements should be driven by **real cases logged here**, never by guessing (plan.md §6.5).

This is the reliability engine of the pilot. A salesperson who repeats a wrong fact in a
meeting and gets embarrassed is the one failure that kills trust (plan.md §2, §13) — every
row here is a chance to stop that before rollout.

---

## How to use it (during the daily 15-minute feedback call)

1. For **each complaint** a pilot user raises, add one row to the log table below.
2. Ask the three questions that make a row actionable:
   - **Which client?** (name + city — lets you find the exact run in `research_logs`)
   - **Which section?** (LinkedIn / RERA / Website / News / Analysis / Q&A / Crux)
   - **What was wrong, and what's actually true?** (the specific claim, not "it was bad")
3. Fill `Fix →` from the cheat sheet — it maps the section to the exact prompt constant.
4. When you ship a prompt edit for it, bump `PROMPT_VERSION` in `lib/prompts.ts` and set the
   row's **Status** to `fixed pX.Y`.

> A logged complaint with no client + no specific claim is not actionable — it can't be
> reproduced or verified. Push for the specific fact every time.

### Severity key
- **H (High)** — a **wrong fact** that could embarrass the salesperson in the meeting
  (wrong company, false claim, made-up project). Fix first, same day.
- **M (Medium)** — **missing or thin**: a real thing the section should have found but didn't.
- **L (Low)** — wording, tone, ordering, formatting. Fix in a batch.

### Issue-type key
`wrong-company` · `wrong-fact` · `missing-info` · `thin/unhelpful` · `outdated` ·
`no-source` (a claim with no link — should have been code-dropped) · `other`

---

## Section → prompt cheat sheet (where to make the edit)

Every issue maps to exactly one prompt constant in **`lib/prompts.ts`**:

| Section flagged (what the user saw)                | Edit this constant   | Line |
|----------------------------------------------------|----------------------|------|
| "From our existing data" crux                      | `CRUX_SYSTEM`        | 68   |
| LinkedIn / RERA / Website / News section content   | `RESEARCH_SYSTEM`    | 110  |
| "How to approach this meeting" analysis            | `ANALYSIS_SYSTEM`    | 174  |
| "What's changed since last visit" (repeat visit)   | `COMPARISON_SYSTEM`  | 229  |
| A follow-up question answer                        | `QA_SYSTEM`          | 274  |

**`wrong-company`** almost always means the **identity check** in `RESEARCH_SYSTEM` (line 129)
needs tightening — that's the highest-stakes edit in the whole app.

⚠️ Be careful editing the *search-mechanics* part of `RESEARCH_SYSTEM` (the `await web_search(...)`
and query-batching lines) — small changes there can swing run time a lot. Section **wording**
and **accuracy rules** are safe to iterate; the sandbox instructions are not.

---

## Finding the exact run (optional, for cost/latency correlation)

`research_logs` records the run but **not** which prompt version produced it (see note below).
To find the run behind a complaint, match on the client's account + the time of the meeting:

```sql
-- Runs for one client on one day (IST). Swap the name + date.
select r.created_at at time zone 'Asia/Kolkata' as ist,
       r.run_type, r.estimated_cost_usd, round(r.duration_ms/1000.0,1) as secs,
       r.feedback, r.error
from research_logs r
join accounts a on a.id = r.account_id
where a.name ilike '%BALAJI PLY%'
  and (r.created_at at time zone 'Asia/Kolkata')::date = '2026-07-16'
order by r.created_at desc;
```

---

## The log

Add newest at the top. Copy the blank row to start a new entry.

| Date (IST) | Reporter | Client — City | Section | Issue type | Sev | What it said → what's actually true | Source shown? | Fix → | Prompt ver | Status |
|------------|----------|---------------|---------|------------|-----|--------------------------------------|---------------|-------|-----------|--------|
| _ex_ 2026-07-16 | Mansi V. | BALAJI PLYHOME — Nagpur | RERA | wrong-company | H | Showed a MahaRERA project for "Balaji Developers" (Pune) → that's a different firm; our client is a plywood dealer, not a developer | yes (link) | `RESEARCH_SYSTEM` identity check (l.129) | p4.0 | fixed p4.1 |
|  |  |  |  |  |  |  |  |  |  | open |
|  |  |  |  |  |  |  |  |  |  | open |
|  |  |  |  |  |  |  |  |  |  | open |

---

## Note: prompt version is not auto-logged (yet)

`lib/agent.ts` → `logRun()` writes model, tokens, cost, duration, and error to `research_logs`,
but **not** `PROMPT_VERSION`. So today you record the version by hand in the table above
(read the current value at the top of `lib/prompts.ts`).

If prompt tuning gets active during the pilot and you want automatic correlation
("👎 rate dropped after p4.1"), it's a small change:
1. `alter table research_logs add column prompt_version text;` (additive migration)
2. Import `PROMPT_VERSION` in `lib/agent.ts` and add `prompt_version: PROMPT_VERSION` to the
   `logRun()` insert (agent.ts:771).

Not needed for the pilot to run — the manual column here is enough. Do it only if the
hand-logging becomes the bottleneck.
