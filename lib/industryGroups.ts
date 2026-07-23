// V2 Phase 0 — curated Industry filter groups.
// Zoho's raw accounts.industry (Nature_of_Account) has 19+ distinct
// values, 80% concentrated in "Group Housing Builder". This table folds
// them into a small set the phone UI can show as one <select>. Editable
// here without a migration — see plan.md §10 V2 Phase 0.
//
// Bucket placement for Institutional / Enduser upto G+5 / PMC (Private)
// is a best-effort guess (owner confirmed 2026-07-23: not GHB-relevant,
// don't block on precision). Revisit only if a non-GHB segment becomes
// a real priority.
export interface IndustryGroup {
  key: string;
  label: string;
  rawValues: string[];
  /** true if null/unset accounts.industry should also match this group. */
  includeNull?: boolean;
}

export const INDUSTRY_GROUPS: IndustryGroup[] = [
  {
    key: "ghb",
    label: "GHB",
    rawValues: ["Group Housing Builder"],
  },
  {
    key: "govt",
    label: "Govt",
    rawValues: ["Govt. Contractor", "Govt. Department"],
  },
  {
    key: "private_builder",
    label: "Private Builder",
    rawValues: ["Private Contractor", "Builder upto G+5", "Builder Above G+5"],
  },
  {
    key: "design_consultancy",
    label: "Design & Consultancy",
    rawValues: ["Private Architecture Firm", "Interior Designer", "Façade Design Consultancy Firm"],
  },
  {
    key: "trade_supply",
    label: "Trade & Supply",
    rawValues: ["Dealer", "Fabricator", "UPVC", "CNC Job Work", "Door / Frame Manufacturer", "Retailer"],
  },
  {
    key: "institutional_other",
    label: "Institutional / Other",
    rawValues: ["Institutional", "Enduser upto G+5", "PMC (Private)", "Other"],
    includeNull: true,
  },
];

const GROUP_BY_KEY = new Map(INDUSTRY_GROUPS.map((g) => [g.key, g]));

export function industryGroup(key: string | undefined | null): IndustryGroup | undefined {
  return key ? GROUP_BY_KEY.get(key) : undefined;
}

/** The GHB group key — kept for the general ad-hoc Industry filter. */
export const GHB_GROUP_KEY = "ghb";

// ── GHB Customer/Prospect — the REAL Zoho tags, not a mechanical
// Industry+Stage proxy [corrected 2026-07-23] ──────────────────────
// An earlier version of this file derived "GHB Customer" as Industry
// GHB + Stage Order Punched — that was wrong (computed ~1-229 accounts
// vs. the real 740). Zoho already has a hand-curated Prospect/Customer
// tagging system on Accounts (confirmed live: readable via the plain
// REST API's Tag field once ZohoCRM.settings.tags.READ scope was
// added — COQL cannot select Tag at all). These are the real tag
// names; `accounts.dream100_tags` (migration 007) stores them.
export const GHB_CUSTOMER_TAG = "D- 100 GHB Customers";
export const GHB_PROSPECT_TAG = "D- 100 GHB Prospects";

// Frozen, independent of lib/zoho.ts's ACTIVE_DEAL_STAGES on purpose:
// once V2 Phase 0b adds "Order Punched" to that array (to bring it into
// sync scope for the Customer preset), a preset that spread
// [...ACTIVE_DEAL_STAGES] would silently start counting Order Punched
// deals as "Prospect" too, breaking the tag+stage split the owner
// defined (Prospect = these 5 only; Customer = Order Punched only).
export const GHB_PROSPECT_STAGES = [
  "4 Phase",
  "Mockup",
  "MockUp Approval",
  "Value Period Till Stage Arrival",
  "Order Confirmed",
] as const;
