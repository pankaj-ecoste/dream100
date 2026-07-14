// Line-based renderer for agent output (crux, sections, analysis).
// Splits on newlines: "- " lines become styled bullets, everything else
// a paragraph; the text inside goes through InlineText (bold + links
// only — the full safety story lives in that file's header).
//
// muteProse: sections use it so their non-bullet lines — which are the
// honest empty-state sentences ("No RERA presence found.") — read as
// quiet statements, visibly different from sourced findings.
import InlineText from "./InlineText";

const BULLET_PREFIX = /^\s*(?:[-*•]|\d+\.)\s+/;

export default function AgentText({
  text,
  muteProse = false,
}: {
  text: string;
  muteProse?: boolean;
}) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return (
    <div className="space-y-1.5 text-sm text-zinc-700">
      {lines.map((line, i) => {
        const bullet = BULLET_PREFIX.exec(line);
        if (bullet) {
          return (
            <p key={i} className="flex gap-2">
              <span className="text-brand-blue">•</span>
              <span>
                <InlineText text={line.slice(bullet[0].length)} />
              </span>
            </p>
          );
        }
        return (
          <p key={i} className={muteProse ? "italic text-zinc-500" : undefined}>
            <InlineText text={line} />
          </p>
        );
      })}
    </div>
  );
}
