// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// markdown-lite RENDER half of the assistant answer formatter. Presentational
// (pure render over the parsing half in copilot-markdown.ts — no state, no
// effects). ZERO markup change: every block arm (code fence / bullet list /
// numbered list / paragraph) and the InlineMd bold/italic/code arms survive
// byte-identical.

import {
  isBulletListBlock,
  isCodeFenceBlock,
  isNumberedListBlock,
  parseInlineMd,
  splitMdBlocks,
} from "./copilot-markdown";

// ──────────────────────────────────────────────────────────────────────
// Markdown-lite — bold, code, lists, line breaks. No deps.
// ──────────────────────────────────────────────────────────────────────

export function MarkdownLite({ text }: { text: string }) {
  // Split into blocks separated by blank lines.
  const blocks = splitMdBlocks(text);
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        // Code fence
        if (isCodeFenceBlock(lines)) {
          const code = lines.slice(1, -1).join("\n");
          return (
            <pre
              key={i}
              dir="ltr"
              className="text-2xs font-mono bg-background/60 border border-border rounded-lg p-2 overflow-x-auto whitespace-pre"
            >
              {code}
            </pre>
          );
        }
        // List
        if (isBulletListBlock(lines)) {
          return (
            <ul key={i} className="list-disc ps-4 space-y-0.5">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>
                    <InlineMd text={l.replace(/^\s*[-*•]\s+/, "")} />
                  </li>
                ))}
            </ul>
          );
        }
        // Numbered list
        if (isNumberedListBlock(lines)) {
          return (
            <ol key={i} className="list-decimal ps-4 space-y-0.5">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>
                    <InlineMd text={l.replace(/^\s*\d+\.\s+/, "")} />
                  </li>
                ))}
            </ol>
          );
        }
        // Paragraph with line breaks preserved
        return (
          <p key={i} className="whitespace-pre-wrap">
            <InlineMd text={block} />
          </p>
        );
      })}
    </div>
  );
}

function InlineMd({ text }: { text: string }) {
  const tokens = parseInlineMd(text);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "bold") return <strong key={i}>{t.value}</strong>;
        if (t.type === "italic") return <em key={i}>{t.value}</em>;
        if (t.type === "code")
          return (
            <code
              key={i}
              dir="ltr"
              className="px-1 py-0.5 rounded bg-background/70 border border-border/40 text-2xs font-mono"
            >
              {t.value}
            </code>
          );
        return <span key={i}>{t.value}</span>;
      })}
    </>
  );
}
