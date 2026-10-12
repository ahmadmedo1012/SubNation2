// R137 (2-a decomposition): the markdown-lite PARSING half extracted
// verbatim from CopilotPanel.tsx's MarkdownLite/InlineMd — block
// classification + inline tokenization are pure string logic, so they
// moved to this React-free module (the RENDER half stayed the
// MarkdownLite.tsx component and consumes these by name). ZERO behavior
// change: every regex and arm order survives byte-identical.

/** One inline token — InlineMd's render arms (bold/italic/code/text). */
export type InlineToken = {
  type: "text" | "bold" | "italic" | "code";
  value: string;
};

/** Split into blocks separated by blank lines. */
export function splitMdBlocks(text: string): string[] {
  return text.split(/\n{2,}/);
}

/** Code fence: the first AND last line both open with ```. */
export function isCodeFenceBlock(lines: string[]): boolean {
  return Boolean(lines[0]?.startsWith("```") && lines[lines.length - 1]?.startsWith("```"));
}

/** Bullet list: every line is a `-`/`*`/`•` item (or blank). */
export function isBulletListBlock(lines: string[]): boolean {
  return lines.every((l) => /^\s*[-*•]\s+/.test(l) || l.trim() === "");
}

/** Numbered list: every line is a `1.` item (or blank). */
export function isNumberedListBlock(lines: string[]): boolean {
  return lines.every((l) => /^\s*\d+\.\s+/.test(l) || l.trim() === "");
}

/** Inline tokenizer — **bold**, *italic*, `code`. Order matters: code
 * first so its contents are not re-processed. */
export function parseInlineMd(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) tokens.push({ type: "bold", value: tok.slice(2, -2) });
    else if (tok.startsWith("`")) tokens.push({ type: "code", value: tok.slice(1, -1) });
    else tokens.push({ type: "italic", value: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}
