import { formatDate, formatINR } from "@/lib/format";

type Deal = {
  name: string | null;
  stage: string | null;
  contact_name: string | null;
  mobile: string | null;
  cities: string[] | null;
  amount: number | null;
  raw: Record<string, unknown> | null;
};

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm font-medium text-zinc-900">{value ?? "—"}</p>
    </div>
  );
}

export default function DealDetail({ deal }: { deal: Deal }) {
  // Modified_Time isn't flattened into its own column — it rides in the
  // raw Zoho payload captured at sync time (deals.raw), same field every
  // nightly/webhook sync already fetches (see DEAL_FIELDS in lib/zoho.ts).
  const modifiedTime =
    typeof deal.raw?.Modified_Time === "string" ? deal.raw.Modified_Time : null;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-zinc-900">
          {deal.name ?? "Untitled opportunity"}
        </h1>
        <span className="shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-xs text-white">
          {deal.stage ?? "—"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Project city"
          value={deal.cities && deal.cities.length > 0 ? deal.cities.join(", ") : null}
        />
        <Field label="Expected value" value={formatINR(deal.amount)} />
        <Field label="Contact" value={deal.contact_name} />
        <Field label="Mobile" value={deal.mobile} />
        <Field label="Last updated in CRM" value={modifiedTime ? formatDate(modifiedTime) : null} />
      </div>
    </div>
  );
}
