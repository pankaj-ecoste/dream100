// No "use client" — a plain <form method="GET"> works without any
// JavaScript. Submitting navigates to `/?q=...`; Next.js re-renders
// app/page.tsx on the server with the new searchParams. This is the
// fastest possible search on a slow phone connection: no client bundle,
// no fetch waterfall, just one navigation.
export default function SearchBar({ defaultValue }: { defaultValue: string }) {
  return (
    <form method="GET" action="/" className="mb-6">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search by client name or city…"
        autoComplete="off"
        className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-brand-blue"
      />
    </form>
  );
}
