import Link from "next/link";
import { formatINR, formatSyncedAt } from "@/lib/format";

type Account = {
  name: string;
  city: string | null;
  industry: string | null;
  ho_location: string | null;
  vertical: string | null;
  working_status: string | null;
  account_unique_number: string | null;
  synced_at: string | null;
};

type Deal = {
  id: string;
  name: string | null;
  stage: string | null;
  contact_name: string | null;
  mobile: string | null;
  cities: string[] | null;
  amount: number | null;
};

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm font-medium text-zinc-900">{value ?? "—"}</p>
    </div>
  );
}

export default function ClientRecord({
  accountId,
  account,
  deals,
}: {
  accountId: string;
  account: Account;
  deals: Deal[];
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-zinc-900">{account.name}</h1>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500">
          {formatSyncedAt(account.synced_at)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="City" value={account.city} />
        <Field label="Location" value={account.ho_location} />
        <Field label="Industry" value={account.industry} />
        <Field label="Vertical" value={account.vertical} />
        <Field label="Working status" value={account.working_status} />
        <Field label="Account #" value={account.account_unique_number} />
      </div>

      {deals.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">
            Open opportunities ({deals.length})
          </h2>
          <div className="space-y-2">
            {deals.map((deal) => (
              <Link
                key={deal.id}
                href={`/client/${accountId}/deal/${deal.id}`}
                className="block rounded-lg border border-zinc-200 p-3 text-sm active:bg-zinc-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-zinc-900">
                    {deal.name ?? "Untitled opportunity"}
                  </p>
                  <span className="shrink-0 rounded-full bg-zinc-900 px-2 py-0.5 text-xs text-white">
                    {deal.stage ?? "—"}
                  </span>
                </div>
                <p className="mt-1 text-zinc-500">
                  {deal.cities && deal.cities.length > 0
                    ? deal.cities.join(", ")
                    : "No project city on file"}
                  {" · "}
                  {formatINR(deal.amount)}
                </p>
                {(deal.contact_name || deal.mobile) && (
                  <p className="mt-1 text-zinc-500">
                    {[deal.contact_name, deal.mobile].filter(Boolean).join(" · ")}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
