// One research section card (People / RERA / Website / News).
// Appears the moment its first streamed text arrives; while streaming
// it shows a pulsing cursor; once finalized, the (source-link-enforced)
// text replaces the streamed text and any removed-bullet count is
// disclosed — silently hiding that we dropped something would be its
// own kind of dishonesty.
import AgentText from "./AgentText";

export default function FindingsSection({
  title,
  text,
  final,
  dropped,
}: {
  title: string;
  text: string;
  final: boolean;
  dropped: number;
}) {
  return (
    <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-blue">
        {title}
      </h3>
      <AgentText text={text} muteProse />
      {!final && (
        <span className="mt-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-brand-blue/40" />
      )}
      {final && dropped > 0 && (
        <p className="mt-3 text-xs text-zinc-400">
          {dropped} unverified item{dropped > 1 ? "s" : ""} removed (no source
          link)
        </p>
      )}
    </section>
  );
}
