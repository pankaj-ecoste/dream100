// Renders the tiny markdown subset the agent emits — **bold** and
// [label](url) links — as real React elements.
//
// Deliberately NOT a markdown library and NOT dangerouslySetInnerHTML:
// model output is built partly from web content, i.e. untrusted input
// (plan.md §13 / prompt-injection risk). The only elements this can
// ever produce are <strong> and <a>, and link hrefs must start with
// http(s):// by construction of the regex. Nothing else gets through.
import type { ReactNode } from "react";

const TOKEN_RE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export default function InlineText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      // **bold**
      nodes.push(<strong key={match.index}>{match[1]}</strong>);
    } else {
      // [label](https://…) — new tab; noopener/noreferrer because the
      // destination is an arbitrary site found via web search.
      nodes.push(
        <a
          key={match.index}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-blue underline underline-offset-2"
        >
          {match[2]}
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return <>{nodes}</>;
}
