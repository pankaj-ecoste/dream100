// Small display formatters shared by Phase 2's screens. Deliberately NOT
// the plan.md Phase 3 lib/format.ts (bullet/source-link enforcement for
// agent findings) — that's a different concern and will live alongside
// these once Phase 3 starts.

// "Synced 14:32" — always in IST, regardless of where the server runs.
// Vercel's serverless functions default their process timezone to UTC,
// so without pinning timeZone explicitly, every salesperson would see a
// freshness stamp 5.5 hours off from the actual sync time.
export function formatSyncedAt(timestamp: string | null): string {
  if (!timestamp) return "Not yet synced";
  const time = new Date(timestamp).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Synced ${time}`;
}

export function formatINR(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// "12 Jul 2026" — used on Timeline rows.
export function formatDate(timestamp: string | null): string {
  if (!timestamp) return "Undated";
  return new Date(timestamp).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
