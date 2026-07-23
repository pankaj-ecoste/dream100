// Zoho CRM integration: OAuth token refresh + COQL query execution +
// the upsert path that writes Zoho records into Supabase.
// This is the ONLY file that talks to Zoho — nothing else in the app
// should import from "zoho-oauth" or fetch zohoapis.com directly.
//
// PRODUCTION DEBUG MAP: "sync stopped working" / "dead refresh token"
// alert → this file. Token refresh failures are logged loudly (see
// getAccessToken) because a silent failure here means stale data
// gets shown to salespeople as if it were fresh — the exact failure
// mode Section 13 of plan.md guards against.
import { createAdminClient } from "./supabase/admin";

// ── Access token cache ───────────────────────────────────────────
// Zoho access tokens last 1 hour (3600s). Refreshing on every request
// would work but wastes a network round-trip and burns Zoho's rate
// limit for no reason — like reusing a DB connection instead of
// opening a new one per query. We keep the token in a module-level
// variable (survives across requests within the same serverless
// function instance) and only ask Zoho for a new one once the old
// one is within 5 minutes of expiring.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function fetchNewAccessToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL("/oauth/v2/token", process.env.ZOHO_ACCOUNTS_URL);
  url.searchParams.set("refresh_token", process.env.ZOHO_REFRESH_TOKEN!);
  url.searchParams.set("client_id", process.env.ZOHO_CLIENT_ID!);
  url.searchParams.set("client_secret", process.env.ZOHO_CLIENT_SECRET!);
  url.searchParams.set("grant_type", "refresh_token");

  const res = await fetch(url, { method: "POST" });
  const data = await res.json();

  if (!data.access_token) {
    // This is the "alert-on-failure" plan.md §9 Phase 1 calls for.
    // For now it throws loudly; a later pass wires this into an
    // actual email/Slack alert (sync failure = stale data shown as
    // fresh, the single worst trust failure per §13).
    console.error("Zoho token refresh FAILED:", JSON.stringify(data));
    throw new Error(`Zoho token refresh failed: ${data.error ?? "unknown error"}`);
  }

  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Returns a valid Zoho access token, refreshing only when needed. */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (cachedToken && cachedToken.expiresAt - fiveMinutes > now) {
    return cachedToken.accessToken;
  }

  const { accessToken, expiresIn } = await fetchNewAccessToken();
  cachedToken = { accessToken, expiresAt: now + expiresIn * 1000 };
  return accessToken;
}

// ── COQL query execution ─────────────────────────────────────────
// COQL = "CRM Object Query Language" — Zoho's SQL-like query syntax,
// e.g. "select id, Account_Name from Accounts where ... limit 200".
// This is the low-level primitive; ACCOUNT_FIELDS and the actual
// filter criteria (from the field-mapping pass) build queries on
// top of this function.
export async function coqlQuery(query: string): Promise<Record<string, unknown>[]> {
  const accessToken = await getAccessToken();
  const url = `${process.env.ZOHO_API_DOMAIN}/crm/v8/coql`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ select_query: query }),
  });

  // Zoho returns 204 No Content (empty body) when a query matches zero
  // records — res.json() would throw on empty input, so short-circuit.
  if (res.status === 204) {
    return [];
  }

  const bodyText = await res.text();
  const data = bodyText ? JSON.parse(bodyText) : {};

  if (!res.ok) {
    console.error("Zoho COQL query FAILED:", res.status, JSON.stringify(data));
    throw new Error(`Zoho COQL query failed (${res.status}): ${data.message ?? "unknown error"}`);
  }

  return data.data ?? [];
}

// ── Field maps ────────────────────────────────────────────────────
// Only these fields are ever fetched from Zoho — everything else on
// the Accounts/Deals modules (100+ fields each, most of it unrelated
// operational clutter: installation %, audits, tender workflow) is
// ignored. Confirmed against real data + the owner 2026-07-09.
export const ACCOUNT_FIELDS = [
  "id",
  "Account_Name",
  "Owner",                  // {id, name} — id resolves to a real Zoho user (see getZohoUsers)
  "City_Name",               // -> accounts.city (head-office city; picklist, messy: "Bangalore" AND "Bengaluru" both exist)
  "Location",                 // -> accounts.ho_location (head-office locality, free text)
  "Account_Unique_Number",     // -> accounts.account_unique_number
  "Account_Working_Status",     // -> accounts.working_status
  "Belongs_To",                  // -> accounts.vertical ("Belongs To Which Vertical?": ESP/Pvt Project/Govt/Enduser/Metamask/Lamora/ENP/SCP)
                                   //    NOTE: this is Ecoste's own sales-channel classification, not the
                                   //    client's business type — that's Nature_of_Account below, which is
                                   //    what the agent's search-query enrichment (plan.md §6.4) actually needs.
  "Nature_of_Account",             // -> accounts.industry (e.g. "Real Estate Developer", "Interior Designer",
                                     //    "Architecture Firm") — added 2026-07-09 specifically to feed the
                                     //    agent's query enrichment ("{name} {city} {industry} {year}")
  // "Region" deliberately excluded: neither COQL nor the REST API can read it
  // (Zoho field-level security, confirmed 2026-07-09) — including it breaks
  // this entire query. Add back once the owner's Zoho admin fixes the
  // permission (Setup -> Security Control -> Field Level Security -> Accounts).
  // Also resolve api_name "Region" (labeled "Zone.", North/East/West/South)
  // vs api_name "Zone" (labeled "Region.", North 1, North 2...) — labels
  // are swapped, and we haven't confirmed which one accounts.region wants.
  "Modified_Time",                  // drives incremental nightly sync (Modified_Time > last successful run)
] as const;

export const DEAL_FIELDS = [
  "id",
  "Deal_Name",               // -> deals.name ("Opportunity Name")
  "Stage",                    // -> deals.stage — see ACTIVE_DEAL_STAGES, only 5 of 120+ values matter
  "Contact_Name",               // {id, name} lookup
  "Mobile_No",                    // -> deals.mobile (NOT "Mobile" — that field is unused/different, confirmed 2026-07-09)
  "Cities",                        // multiselect picklist — the PROJECT's city (vs Account's head-office city)
  "Account_Name",                   // {id, name} lookup — this is the FK: deals.account_id resolves via
                                      //   Account_Name.id -> accounts.crm_record_id -> accounts.id
  "Expected_Value",                   // -> deals.amount (confirmed populated; Latest_Quotation_Value/
                                        //   Project_Worth/WPC_VALUE/Tender_Value are all empty in practice)
  "Modified_Time",
] as const;

// The stages that matter for this app. A deal earns "prospect" status
// at "4 Phase" (lead agreed to a 4-phase presentation).
//
// "Order Punched" ADDED [2026-07-23, V2 Phase 0b] — reverses the
// original 2026-07-09 decision to stop one stage short of it. That
// decision assumed a won deal has "nothing left to prepare for," but
// the owner clarified Order Punched accounts ARE the product's "Dream
// 100" customer base (repeat orders, account growth, relationship
// maintenance) — see plan.md §10 Phase 0b and the GHB (Customer) preset
// (lib/industryGroups.ts), which specifically needs these deals synced
// to compute correctly. This one array drives scope-admission
// uniformly across bulk import, webhook, and nightly cron — no other
// code path needed to change for Order Punched deals to start syncing.
export const ACTIVE_DEAL_STAGES = [
  "4 Phase",
  "Mockup",
  "MockUp Approval",
  "Value Period Till Stage Arrival",
  "Order Confirmed",
  "Order Punched",
] as const;

function coqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

// Zoho's COQL datetime literal rejects fractional seconds (confirmed
// 2026-07-10: "2026-07-08T18:30:00.000Z" -> INVALID_QUERY, plain "Z"
// works fine) — both JS's toISOString() and Postgres's timestamptz
// text form emit fractional seconds, so every datetime literal must
// be stripped before going into a query.
function coqlDatetimeLiteral(iso: string): string {
  return coqlStringLiteral(iso.replace(/\.\d+/, ""));
}

/** The primary sync entry point: active deals, which drives which accounts we care about. */
export function buildActiveDealsQuery(limit = 200, offset = 0): string {
  const stageList = ACTIVE_DEAL_STAGES.map(coqlStringLiteral).join(", ");
  return `select ${DEAL_FIELDS.join(", ")} from Deals where Stage in (${stageList}) limit ${limit} offset ${offset}`;
}

/** Fetches full Account records for a batch of Zoho account IDs (from Deals' Account_Name.id lookups). */
export function buildAccountsByIdsQuery(zohoAccountIds: string[]): string {
  const idList = zohoAccountIds.join(", ");
  return `select ${ACCOUNT_FIELDS.join(", ")} from Accounts where id in (${idList})`;
}

/** Fetches full Deal records for a batch of Zoho deal IDs — used by the webhook (single-record fetch). */
export function buildDealsByIdsQuery(zohoDealIds: string[]): string {
  const idList = zohoDealIds.join(", ");
  return `select ${DEAL_FIELDS.join(", ")} from Deals where id in (${idList})`;
}

/** Deals touched since the last successful nightly run — drives the nightly cron. */
export function buildModifiedDealsQuery(sinceIso: string, limit = 200, offset = 0): string {
  return `select ${DEAL_FIELDS.join(", ")} from Deals where Modified_Time > ${coqlDatetimeLiteral(sinceIso)} limit ${limit} offset ${offset}`;
}

/** Accounts touched since the last successful nightly run — catches edits no Deal change would surface. */
export function buildModifiedAccountsQuery(sinceIso: string, limit = 200, offset = 0): string {
  return `select ${ACCOUNT_FIELDS.join(", ")} from Accounts where Modified_Time > ${coqlDatetimeLiteral(sinceIso)} limit ${limit} offset ${offset}`;
}

// ── Zoho Users (for the signup salesperson dropdown) ──────────────
// Salespeople are real Zoho users (they appear as Account/Deal
// "Owner"), but aren't necessarily reachable by a personal email
// (some share inboxes like sales@ecoste.in). So instead of matching
// by name text (typo-prone) or email (unreliable), signup shows a
// dropdown built from this list; the salesperson picks their own
// name, and we store their Zoho user ID on users.zoho_user_id for
// exact-match syncing forever after. Decided 2026-07-09.
export async function getZohoUsers(): Promise<{ id: string; fullName: string; email: string }[]> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${process.env.ZOHO_API_DOMAIN}/crm/v8/users?type=ActiveUsers`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const data = await res.json();
  return (data.users ?? []).map((u: any) => ({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
  }));
}

// ── Upsert into Supabase ────────────────────────────────────────────
// Both the webhook and the nightly cron will call these same
// functions — "one code path" per plan.md §4.2. Deal-first: a deal's
// Account_Name lookup is how we discover which account to upsert,
// matching the account-centric join design in §4.3.

type ZohoLookup = { id: string; name: string } | null;

type AccountRow = Record<string, unknown> & {
  id: string;
  Account_Name: string;
  Owner: ZohoLookup;
  City_Name: string | null;
  Location: string | null;
  Account_Unique_Number: string | null;
  Account_Working_Status: string | null;
  Belongs_To: string | null;
  Nature_of_Account: string | null;
  // NOT a COQL field — COQL can't select "Tag" (confirmed: SYNTAX_ERROR).
  // Populated separately by attachDream100Tags() via a plain REST call,
  // after the COQL fetch, before upsertAccount().
  dream100Tags?: string[];
};

// ── Dream100 account tags (Accounts module only — Deals carries
// different, unrelated tags) ─────────────────────────────────────
// COQL cannot select "Tag" at all. The plain REST list/get endpoints
// can, but only with the ZohoCRM.settings.tags.READ scope granted
// (confirmed live 2026-07-23: without it, every record silently came
// back with an empty Tag array, even ones known-tagged in the CRM UI —
// no error, just empty, which is what made this take so long to find).
// tag_names= filtering is broken (silently no-ops, confirmed live) —
// so every synced account's Tag array is fetched and matched client-side.
const ZOHO_IN_CLAUSE_MAX = 100;

async function fetchAccountTagsByIds(zohoAccountIds: string[]): Promise<Map<string, string[]>> {
  const tagsByAccountId = new Map<string, string[]>();
  if (zohoAccountIds.length === 0) return tagsByAccountId;

  const accessToken = await getAccessToken();
  for (let i = 0; i < zohoAccountIds.length; i += ZOHO_IN_CLAUSE_MAX) {
    const idBatch = zohoAccountIds.slice(i, i + ZOHO_IN_CLAUSE_MAX);
    const res = await fetch(
      `${process.env.ZOHO_API_DOMAIN}/crm/v8/Accounts?ids=${idBatch.join(",")}&fields=id,Tag`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );
    const data = await res.json();
    for (const row of data.data ?? []) {
      tagsByAccountId.set(row.id, (row.Tag ?? []).map((t: { name: string }) => t.name));
    }
  }
  return tagsByAccountId;
}

/** Mutates each account row in place, attaching its real Dream100 tags before upsert. */
async function attachDream100Tags(accounts: AccountRow[]): Promise<void> {
  if (accounts.length === 0) return;
  const tagsByAccountId = await fetchAccountTagsByIds(accounts.map((a) => a.id));
  for (const account of accounts) {
    account.dream100Tags = tagsByAccountId.get(account.id) ?? [];
  }
}

type DealRow = Record<string, unknown> & {
  id: string;
  Deal_Name: string;
  Stage: string;
  Contact_Name: ZohoLookup;
  Mobile_No: string | null;
  Cities: string[] | null;
  Account_Name: ZohoLookup;
  Expected_Value: number | null;
};

/** Upserts one Zoho Account into Supabase. Returns the internal (uuid) account id. */
export async function upsertAccount(row: AccountRow): Promise<string> {
  const supabase = createAdminClient();

  // Resolve the salesperson: Owner.id is Zoho's permanent user ID, matched
  // against users.zoho_user_id (set at signup via the getZohoUsers dropdown).
  // No match yet (salesperson hasn't signed up) -> assigned_user_id stays
  // null, which is safe-by-design: the account is simply invisible to
  // everyone until a real salesperson claims it.
  let assignedUserId: string | null = null;
  if (row.Owner?.id) {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("zoho_user_id", row.Owner.id)
      .maybeSingle();
    assignedUserId = user?.id ?? null;
  }

  const { data, error } = await supabase
    .from("accounts")
    .upsert(
      {
        crm_record_id: row.id,
        name: row.Account_Name,
        city: row.City_Name ?? null,
        ho_location: row.Location ?? null,
        account_unique_number: row.Account_Unique_Number ?? null,
        working_status: row.Account_Working_Status ?? null,
        vertical: row.Belongs_To ?? null,
        industry: row.Nature_of_Account ?? null,
        dream100_tags: row.dream100Tags ?? [],
        zoho_owner_id: row.Owner?.id ?? null,
        assigned_user_id: assignedUserId,
        raw: row,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "crm_record_id" }
    )
    .select("id")
    .single();

  if (error) {
    console.error("upsertAccount FAILED:", row.id, error);
    throw new Error(`upsertAccount failed for Zoho account ${row.id}: ${error.message}`);
  }

  return data.id;
}

/** Upserts one Zoho Deal into Supabase, linked to its already-upserted parent account. */
export async function upsertDeal(row: DealRow, accountId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("deals").upsert(
    {
      crm_record_id: row.id,
      account_id: accountId,
      name: row.Deal_Name,
      stage: row.Stage,
      contact_name: row.Contact_Name?.name ?? null,
      mobile: row.Mobile_No ?? null,
      cities: row.Cities ?? [],
      amount: row.Expected_Value ?? null,
      raw: row,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "crm_record_id" }
  );

  if (error) {
    console.error("upsertDeal FAILED:", row.id, error);
    throw new Error(`upsertDeal failed for Zoho deal ${row.id}: ${error.message}`);
  }
}

/**
 * Syncs one page of active-stage deals: fetches the deals, resolves and
 * upserts their parent accounts, then upserts the deals themselves.
 * This is the function both the nightly cron and the bulk import script
 * call — same code path for both triggers, per plan.md §4.2.
 */
export async function syncActiveDealsPage(
  limit = 200,
  offset = 0
): Promise<{ dealsProcessed: number; accountsProcessed: number; hasMore: boolean }> {
  const deals = (await coqlQuery(buildActiveDealsQuery(limit, offset))) as DealRow[];
  if (deals.length === 0) {
    return { dealsProcessed: 0, accountsProcessed: 0, hasMore: false };
  }

  const zohoAccountIds = [...new Set(deals.map((d) => d.Account_Name?.id).filter(Boolean))] as string[];

  // Zoho caps "where id in (...)" at 100 values — a page of 200 deals can
  // reference up to 200 distinct accounts, so this must be batched.
  // Confirmed 2026-07-09: LIMIT_EXCEEDED, {"by":"where","limit":100}.
  const ZOHO_IN_CLAUSE_MAX = 100;
  const accounts: AccountRow[] = [];
  for (let i = 0; i < zohoAccountIds.length; i += ZOHO_IN_CLAUSE_MAX) {
    const idBatch = zohoAccountIds.slice(i, i + ZOHO_IN_CLAUSE_MAX);
    const batch = (await coqlQuery(buildAccountsByIdsQuery(idBatch))) as AccountRow[];
    accounts.push(...batch);
  }

  await attachDream100Tags(accounts);

  const accountIdByZohoId = new Map<string, string>();
  for (const account of accounts) {
    const internalId = await upsertAccount(account);
    accountIdByZohoId.set(account.id, internalId);
  }

  let dealsProcessed = 0;
  for (const deal of deals) {
    const zohoAccountId = deal.Account_Name?.id;
    const internalAccountId = zohoAccountId ? accountIdByZohoId.get(zohoAccountId) : undefined;
    if (!internalAccountId) {
      console.error("Deal references an account that wasn't resolved — skipping:", deal.id, zohoAccountId);
      continue;
    }
    await upsertDeal(deal, internalAccountId);
    dealsProcessed++;
  }

  return { dealsProcessed, accountsProcessed: accounts.length, hasMore: deals.length === limit };
}

// ── Single-record sync (webhook) ─────────────────────────────────
// The webhook only ever syncs ONE record at a time, by ID, so these
// don't need pagination or the batching syncActiveDealsPage does.
// Scope-admission policy: an already-synced record is always updated
// (even a deal that moved to a stage outside ACTIVE_DEAL_STAGES —
// keeps history intact rather than silently going stale). A record
// NOT already in our tables is only admitted if a deal's current
// Stage qualifies — an Account-module webhook never admits a brand
// new account on its own, since scope discovery is deal-driven
// (§4.3). This mirrors exactly what syncActiveDealsPage does for bulk.

export type SingleSyncResult = { status: "synced" | "skipped"; reason?: string };

/** Syncs a single Zoho Account by ID. Called by the webhook on Accounts-module edits. */
export async function syncOneAccount(zohoAccountId: string): Promise<SingleSyncResult> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("accounts")
    .select("id")
    .eq("crm_record_id", zohoAccountId)
    .maybeSingle();

  if (!existing) {
    return { status: "skipped", reason: "account not in scope (no existing record, not deal-referenced yet)" };
  }

  const rows = (await coqlQuery(buildAccountsByIdsQuery([zohoAccountId]))) as AccountRow[];
  if (rows.length === 0) {
    return { status: "skipped", reason: "account not found in Zoho (deleted?)" };
  }

  await attachDream100Tags(rows);
  await upsertAccount(rows[0]);
  return { status: "synced" };
}

/** Syncs a single Zoho Deal by ID (and its account). Called by the webhook on Deals-module edits. */
export async function syncOneDeal(zohoDealId: string): Promise<SingleSyncResult> {
  const supabase = createAdminClient();

  const dealRows = (await coqlQuery(buildDealsByIdsQuery([zohoDealId]))) as DealRow[];
  if (dealRows.length === 0) {
    return { status: "skipped", reason: "deal not found in Zoho (deleted?)" };
  }
  const deal = dealRows[0];

  const { data: existingDeal } = await supabase
    .from("deals")
    .select("id")
    .eq("crm_record_id", zohoDealId)
    .maybeSingle();

  const isActiveStage = (ACTIVE_DEAL_STAGES as readonly string[]).includes(deal.Stage);
  if (!existingDeal && !isActiveStage) {
    return {
      status: "skipped",
      reason: `deal not in scope (stage "${deal.Stage}" not active, not previously synced)`,
    };
  }

  const zohoAccountId = deal.Account_Name?.id;
  if (!zohoAccountId) {
    return { status: "skipped", reason: "deal has no linked account" };
  }

  const accountRows = (await coqlQuery(buildAccountsByIdsQuery([zohoAccountId]))) as AccountRow[];
  if (accountRows.length === 0) {
    return { status: "skipped", reason: "deal's linked account not found in Zoho (deleted?)" };
  }

  await attachDream100Tags(accountRows);
  const internalAccountId = await upsertAccount(accountRows[0]);
  await upsertDeal(deal, internalAccountId);
  return { status: "synced" };
}

// ── Incremental sync (nightly cron) ──────────────────────────────
// The webhook handles same-minute updates; this heals whatever it
// missed (Zoho workflow rule didn't fire, a request failed, etc.) by
// pulling everything Modified_Time-stamped since the last successful
// run. Same scope-admission policy as the webhook's single-record
// functions, just batched: an already-synced record always updates;
// a brand new one is only admitted via a qualifying Deal.

/** One page of deals modified since `sinceIso`. Mirrors syncActiveDealsPage's account-resolution logic. */
export async function syncModifiedDealsPage(
  sinceIso: string,
  limit = 200,
  offset = 0
): Promise<{ dealsProcessed: number; dealsSkipped: number; accountsProcessed: number; hasMore: boolean }> {
  const deals = (await coqlQuery(buildModifiedDealsQuery(sinceIso, limit, offset))) as DealRow[];
  if (deals.length === 0) {
    return { dealsProcessed: 0, dealsSkipped: 0, accountsProcessed: 0, hasMore: false };
  }

  const supabase = createAdminClient();
  const { data: existingDeals } = await supabase
    .from("deals")
    .select("crm_record_id")
    .in("crm_record_id", deals.map((d) => d.id));
  const existingDealIds = new Set((existingDeals ?? []).map((d) => d.crm_record_id));

  const admittedDeals = deals.filter(
    (d) => existingDealIds.has(d.id) || (ACTIVE_DEAL_STAGES as readonly string[]).includes(d.Stage)
  );
  const dealsSkipped = deals.length - admittedDeals.length;

  if (admittedDeals.length === 0) {
    return { dealsProcessed: 0, dealsSkipped, accountsProcessed: 0, hasMore: deals.length === limit };
  }

  const zohoAccountIds = [...new Set(admittedDeals.map((d) => d.Account_Name?.id).filter(Boolean))] as string[];

  const ZOHO_IN_CLAUSE_MAX = 100;
  const accounts: AccountRow[] = [];
  for (let i = 0; i < zohoAccountIds.length; i += ZOHO_IN_CLAUSE_MAX) {
    const idBatch = zohoAccountIds.slice(i, i + ZOHO_IN_CLAUSE_MAX);
    const batch = (await coqlQuery(buildAccountsByIdsQuery(idBatch))) as AccountRow[];
    accounts.push(...batch);
  }

  await attachDream100Tags(accounts);

  const accountIdByZohoId = new Map<string, string>();
  for (const account of accounts) {
    const internalId = await upsertAccount(account);
    accountIdByZohoId.set(account.id, internalId);
  }

  let dealsProcessed = 0;
  for (const deal of admittedDeals) {
    const zohoAccountId = deal.Account_Name?.id;
    const internalAccountId = zohoAccountId ? accountIdByZohoId.get(zohoAccountId) : undefined;
    if (!internalAccountId) {
      console.error("Modified deal references an account that wasn't resolved — skipping:", deal.id, zohoAccountId);
      continue;
    }
    await upsertDeal(deal, internalAccountId);
    dealsProcessed++;
  }

  return { dealsProcessed, dealsSkipped, accountsProcessed: accounts.length, hasMore: deals.length === limit };
}

/** One page of accounts modified since `sinceIso`. Only refreshes accounts already in scope — never self-admits new ones. */
export async function syncModifiedAccountsPage(
  sinceIso: string,
  limit = 200,
  offset = 0
): Promise<{ accountsProcessed: number; accountsSkipped: number; hasMore: boolean }> {
  const accounts = (await coqlQuery(buildModifiedAccountsQuery(sinceIso, limit, offset))) as AccountRow[];
  if (accounts.length === 0) {
    return { accountsProcessed: 0, accountsSkipped: 0, hasMore: false };
  }

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("accounts")
    .select("crm_record_id")
    .in("crm_record_id", accounts.map((a) => a.id));
  const existingIds = new Set((existing ?? []).map((a) => a.crm_record_id));

  const admittedAccounts = accounts.filter((a) => existingIds.has(a.id));
  await attachDream100Tags(admittedAccounts);

  let accountsProcessed = 0;
  for (const account of admittedAccounts) {
    await upsertAccount(account);
    accountsProcessed++;
  }

  return {
    accountsProcessed,
    accountsSkipped: accounts.length - accountsProcessed,
    hasMore: accounts.length === limit,
  };
}

// ── Notes sync (interactions) ────────────────────────────────────
// Notes attach to EITHER an Account or a Deal (Parent_Id.module.api_name
// tells us which) — confirmed 2026-07-09, no separate Calls/Meetings
// usage. Every interactions row still needs an account_id, so a
// Deal-parented note resolves through our own deals table to find
// its account. COQL supports "Parent_Id in (...)" directly (also
// capped at 100 values, same as the accounts lookup).

export const NOTE_FIELDS = ["id", "Note_Content", "Parent_Id", "Created_Time"] as const;

type NoteRow = {
  id: string;
  Note_Content: string | null;
  Parent_Id: { id: string; module: { api_name: string; id: string } };
  Created_Time: string;
};

// Note_Content carries two layers of junk on top of the real text:
// Zoho's internal @mention markup (crm[user#...]crm) and raw HTML
// (<br>, <span>, etc. — seen when notes were entered via richer UIs).
// A more sophisticated cleanup can move to format.ts once that's
// built (Phase 3); this is the minimum needed so raw markup never
// reaches a salesperson's screen or the agent's context.
function cleanNoteContent(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/crm\[.*?\]crm/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildNotesByParentIdsQuery(zohoParentIds: string[], limit = 200, offset = 0): string {
  const idList = zohoParentIds.join(", ");
  return `select ${NOTE_FIELDS.join(", ")} from Notes where Parent_Id in (${idList}) limit ${limit} offset ${offset}`;
}

/**
 * Syncs Notes for a batch of up to 100 Zoho parent IDs (Account or Deal
 * IDs — Parent_Id doesn't care which). accountIdByZohoRecordId,
 * dealAccountIdByZohoDealId, and dealIdByZohoDealId are pre-built lookup
 * maps (crm_record_id -> internal uuid) so this doesn't hit Supabase
 * per-note. dealIdByZohoDealId additionally stamps deal_id on
 * Deals-parented notes (migration 005) so the opportunity detail screen
 * can show a deal's own notes, not just its parent account's.
 */
async function syncNotesForParentBatch(
  zohoParentIds: string[],
  accountIdByZohoRecordId: Map<string, string>,
  dealAccountIdByZohoDealId: Map<string, string>,
  dealIdByZohoDealId: Map<string, string>
): Promise<{ notesProcessed: number; notesSkipped: number }> {
  const supabase = createAdminClient();
  let notesProcessed = 0;
  let notesSkipped = 0;
  let offset = 0;

  // Collect rows and upsert in bulk (one call per ~500 rows) instead of
  // one round-trip per note — with some accounts carrying years of note
  // history, per-note upserts were far too slow (2 batches took ~5 min
  // in testing, projecting well over an hour for the full sync).
  const UPSERT_CHUNK_SIZE = 500;
  let pendingRows: Record<string, unknown>[] = [];

  async function flush() {
    if (pendingRows.length === 0) return;
    const { error } = await supabase
      .from("interactions")
      .upsert(pendingRows, { onConflict: "crm_note_id" });
    if (error) {
      console.error("interactions bulk upsert FAILED:", error.message);
      notesSkipped += pendingRows.length;
    } else {
      notesProcessed += pendingRows.length;
    }
    pendingRows = [];
  }

  for (;;) {
    const notes = (await coqlQuery(buildNotesByParentIdsQuery(zohoParentIds, 200, offset))) as NoteRow[];
    if (notes.length === 0) break;

    for (const note of notes) {
      const parentModule = note.Parent_Id?.module?.api_name;
      const parentZohoId = note.Parent_Id?.id;
      const accountId =
        parentModule === "Accounts"
          ? accountIdByZohoRecordId.get(parentZohoId)
          : parentModule === "Deals"
            ? dealAccountIdByZohoDealId.get(parentZohoId)
            : undefined;

      if (!accountId) {
        notesSkipped++;
        continue;
      }

      // Explicitly null (not omitted) for Accounts-parented notes, so a
      // re-sync correctly clears deal_id if a note's parent ever changes
      // — the upsert only touches columns present in the object.
      const dealId = parentModule === "Deals" ? (dealIdByZohoDealId.get(parentZohoId) ?? null) : null;

      pendingRows.push({
        account_id: accountId,
        deal_id: dealId,
        crm_note_id: note.id,
        meeting_date: note.Created_Time,
        kind: "note",
        content: cleanNoteContent(note.Note_Content),
      });

      if (pendingRows.length >= UPSERT_CHUNK_SIZE) {
        await flush();
      }
    }

    if (notes.length < 200) break;
    offset += 200;
  }

  await flush();
  return { notesProcessed, notesSkipped };
}

/**
 * Syncs Notes for every currently-synced account and deal. Builds the
 * crm_record_id -> internal id lookup maps once (cheap: ~2k rows total),
 * then batches through Notes in groups of 100 parent IDs.
 */
export async function syncAllNotes(): Promise<{ notesProcessed: number; notesSkipped: number }> {
  const supabase = createAdminClient();

  const { data: accounts } = await supabase.from("accounts").select("id, crm_record_id");
  const { data: deals } = await supabase.from("deals").select("id, crm_record_id, account_id");

  const accountIdByZohoRecordId = new Map<string, string>();
  for (const a of accounts ?? []) {
    if (a.crm_record_id) accountIdByZohoRecordId.set(a.crm_record_id, a.id);
  }

  const dealAccountIdByZohoDealId = new Map<string, string>();
  const dealIdByZohoDealId = new Map<string, string>();
  for (const d of deals ?? []) {
    dealAccountIdByZohoDealId.set(d.crm_record_id, d.account_id);
    dealIdByZohoDealId.set(d.crm_record_id, d.id);
  }

  const allParentIds = [...accountIdByZohoRecordId.keys(), ...dealAccountIdByZohoDealId.keys()];

  const ZOHO_IN_CLAUSE_MAX = 100;
  let notesProcessed = 0;
  let notesSkipped = 0;

  for (let i = 0; i < allParentIds.length; i += ZOHO_IN_CLAUSE_MAX) {
    const batch = allParentIds.slice(i, i + ZOHO_IN_CLAUSE_MAX);
    const result = await syncNotesForParentBatch(
      batch,
      accountIdByZohoRecordId,
      dealAccountIdByZohoDealId,
      dealIdByZohoDealId
    );
    notesProcessed += result.notesProcessed;
    notesSkipped += result.notesSkipped;
    console.log(
      `  Parent batch ${i / ZOHO_IN_CLAUSE_MAX + 1}/${Math.ceil(allParentIds.length / ZOHO_IN_CLAUSE_MAX)}: ${result.notesProcessed} notes (${result.notesSkipped} skipped)`
    );
  }

  return { notesProcessed, notesSkipped };
}

// ── Weekly reconciliation (deletion detection) ───────────────────
// Neither the webhook nor the nightly cron ever see a DELETE — Zoho
// doesn't fire workflow rules on delete, and a deleted record has no
// Modified_Time to find. This walks Zoho's dedicated deleted-records
// log instead (confirmed live 2026-07-10: GET /Accounts/deleted,
// type=all, up to 200/page, info.more_records drives pagination —
// recycle-bin entries retained 60 days, permanently-deleted 120 days,
// both comfortably longer than the weekly cadence) and soft-archives
// any matching account we're still holding as live. Never hard-deletes
// — archived_at is enough for Phase 2 search to hide it. Scoped to
// Accounts only per plan.md §4.2 [LOCKED]; Deals aren't tracked here.

async function fetchDeletedAccountIds(page: number, perPage = 200): Promise<{ ids: string[]; hasMore: boolean }> {
  const accessToken = await getAccessToken();
  const url = new URL(`${process.env.ZOHO_API_DOMAIN}/crm/v8/Accounts/deleted`);
  url.searchParams.set("type", "all");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));

  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });

  // Same 204-on-empty-result quirk as coqlQuery.
  if (res.status === 204) {
    return { ids: [], hasMore: false };
  }

  const bodyText = await res.text();
  const data = bodyText ? JSON.parse(bodyText) : {};

  if (!res.ok) {
    console.error("Zoho deleted-Accounts query FAILED:", res.status, JSON.stringify(data));
    throw new Error(`Zoho deleted-Accounts query failed (${res.status}): ${data.message ?? "unknown error"}`);
  }

  const ids = (data.data ?? []).map((r: { id: string }) => r.id);
  const hasMore = Boolean(data.info?.more_records);
  return { ids, hasMore };
}

/** Walks every page of Zoho's Accounts deleted-records log and soft-archives any matching row we're still holding as live. */
export async function reconcileDeletedAccounts(): Promise<{ deletedIdsSeen: number; archived: number }> {
  const supabase = createAdminClient();
  let deletedIdsSeen = 0;
  let archived = 0;

  for (let page = 1; ; page++) {
    const { ids, hasMore } = await fetchDeletedAccountIds(page);
    deletedIdsSeen += ids.length;

    if (ids.length > 0) {
      const { data, error } = await supabase
        .from("accounts")
        .update({ archived_at: new Date().toISOString() })
        .in("crm_record_id", ids)
        .is("archived_at", null)
        .select("id");

      if (error) {
        console.error("reconcileDeletedAccounts: archive update FAILED:", error.message);
        throw new Error(`reconcileDeletedAccounts failed: ${error.message}`);
      }
      archived += data?.length ?? 0;
    }

    if (!hasMore) break;
  }

  return { deletedIdsSeen, archived };
}
