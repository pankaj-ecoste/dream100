-- ══════════════════════════════════════════════════════════════════════
-- Dream 100 — PILOT METRICS (Phase 5)
-- Paste any numbered block into the Supabase SQL Editor. There is no admin
-- UI by design (plan.md §4.3 — the Supabase dashboard IS the admin panel);
-- these are the saved queries that back the Phase 5 exit gate (§9, §16) and
-- the weekly cost review (§12).
--
-- Two things to know before reading the numbers:
--
--   1. run_type is coarse. The chat route logs the crux, the full web
--      research run, AND the Phase 4 comparison ALL as run_type='research'
--      (migration 001's CHECK has no 'crux' value; comparison cost folds
--      into the research run). They're told apart by cost, not type:
--        · a CRUX is cheap + fast  — ~$0.004, under ~5s
--        · a REAL RESEARCH RUN is  — ~$0.12+, 40–75s
--      Verified against live data: the split at $0.02 is clean (no rows
--      land between $0.02 and $0.05). So throughout:
--        "real research run" = run_type='research' AND estimated_cost_usd >= 0.02
--        "screen open"       = run_type='research' AND estimated_cost_usd <  0.02
--      A crux fires automatically when a salesperson opens a client, so the
--      crux count doubles as a "client screens opened" adoption signal.
--
--   2. All day/time bucketing is in IST (Asia/Kolkata) — the app pins IST
--      everywhere (lib/format.ts), and Vercel/Postgres store UTC.
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. DAILY DASHBOARD ────────────────────────────────────────────────
-- One row per IST day: the at-a-glance pilot health check. Watch
-- research_runs (adoption), errors (should be ~0), cost, and max_run_s
-- (creeping toward 60 = Vercel timeout risk).
select
  (created_at at time zone 'Asia/Kolkata')::date                             as day_ist,
  count(*) filter (where run_type = 'research' and estimated_cost_usd <  0.02
                     and error is null)                                       as screen_opens,
  count(*) filter (where run_type = 'research' and estimated_cost_usd >= 0.02
                     and error is null)                                       as research_runs,
  count(*) filter (where run_type = 'qa' and error is null)                   as qa_runs,
  count(*) filter (where error is not null)                                   as errors,
  round(sum(estimated_cost_usd), 2)                                           as cost_usd,
  round(sum(estimated_cost_usd) * 83, 0)                                      as cost_inr_approx,
  round(avg(duration_ms) filter (where run_type = 'research'
                     and estimated_cost_usd >= 0.02) / 1000.0, 1)             as avg_research_s,
  round(max(duration_ms) filter (where run_type = 'research') / 1000.0, 1)    as max_run_s
from research_logs
group by 1
order by 1 desc;


-- ── 2. THUMBS RATING  (exit gate: ≥80% up on analyses) ────────────────
-- 👍/👎 land on the final analysis (a research run) and on Q&A answers.
-- A falling up-rate is the earliest alarm of prompt drift (§13). Rows with
-- no rating are excluded from the percentage.
select
  run_type,
  count(*) filter (where feedback is not null)                               as rated,
  count(*) filter (where feedback = 1)                                       as thumbs_up,
  count(*) filter (where feedback = -1)                                      as thumbs_down,
  round(100.0 * count(*) filter (where feedback = 1)
        / nullif(count(*) filter (where feedback is not null), 0), 0)        as pct_up
from research_logs
group by run_type
order by run_type;


-- ── 3. SAVE RATE  (exit gate: ≥60%) ───────────────────────────────────
-- A save writes/updates client_findings; the archive trigger moves the
-- prior row into findings_history. So total save EVENTS all-time =
-- (current rows) + (archived rows). Below 60% → investigate prompt quality
-- (people research but don't trust it enough to keep it).
with runs as (
  select count(*) as n
  from research_logs
  where run_type = 'research' and estimated_cost_usd >= 0.02 and error is null
),
saves as (
  select (select count(*) from client_findings)
       + (select count(*) from findings_history) as n
)
select
  saves.n                                              as save_events,
  runs.n                                               as research_runs,
  round(100.0 * saves.n / nullif(runs.n, 0), 0)        as save_rate_pct
from saves, runs;


-- ── 4. PER-USER ADOPTION ──────────────────────────────────────────────
-- Who is actually using it, and are they rating it. A pilot user with 0
-- research_runs after day 1 is a conversation to have, not a metric to wait
-- on. last_active_ist shows drop-off early.
select
  u.full_name,
  u.role,
  count(*) filter (where r.run_type = 'research' and r.estimated_cost_usd >= 0.02
                     and r.error is null)                                     as research_runs,
  count(*) filter (where r.run_type = 'qa')                                   as qa_runs,
  count(*) filter (where r.feedback = 1)                                      as thumbs_up,
  count(*) filter (where r.feedback = -1)                                     as thumbs_down,
  max(r.created_at at time zone 'Asia/Kolkata')                               as last_active_ist
from users u
left join research_logs r on r.user_id = u.id
group by u.id, u.full_name, u.role
order by research_runs desc nulls last;


-- ── 5. COST + CACHE HEALTH  (weekly review, §12) ──────────────────────
-- avg_cost_per_run should sit around $0.12–0.20. avg_cache_read near ZERO
-- across the board means the system-prompt cache is broken — that silently
-- multiplies input cost 2–3× (§12 cost knob d). A healthy 2nd-run-of-the-hour
-- shows tens of thousands of cache_read tokens.
select
  count(*) filter (where estimated_cost_usd >= 0.02 and error is null)        as research_runs,
  round(avg(estimated_cost_usd) filter (where estimated_cost_usd >= 0.02
                     and error is null), 4)                                    as avg_cost_per_run_usd,
  round(sum(estimated_cost_usd), 2)                                            as total_cost_usd,
  round(sum(estimated_cost_usd) * 83, 0)                                       as total_cost_inr_approx,
  round(avg(cache_read_tokens) filter (where estimated_cost_usd >= 0.02), 0)   as avg_cache_read_tokens
from research_logs
where run_type = 'research';


-- ── 6. RECENT ERRORS  (daily debugging) ───────────────────────────────
-- The actual error strings. "client aborted" = a salesperson closed the app
-- mid-run (harmless). Anything else is worth a look at the Vercel logs for
-- app/api/chat. Empty result = a clean day.
select
  created_at at time zone 'Asia/Kolkata'   as ist,
  run_type,
  round(duration_ms / 1000.0, 1)           as secs,
  error
from research_logs
where error is not null
order by created_at desc
limit 20;


-- ── 7. TIMEOUT WATCH  (Vercel 60s cap) ────────────────────────────────
-- Real research runs approaching the Hobby 60s cap. A few in the 55–60s band
-- is fine; a growing cluster means a prompt/tool change pushed latency up and
-- some runs will start dying at exactly 60s. Cross-check with §0's web_search
-- max_uses note before tuning.
select
  created_at at time zone 'Asia/Kolkata'   as ist,
  round(duration_ms / 1000.0, 1)           as secs,
  estimated_cost_usd,
  error
from research_logs
where run_type = 'research' and duration_ms > 55000
order by duration_ms desc;
