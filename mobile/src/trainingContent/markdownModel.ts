import { sanitizeTrainingContentLink } from "./externalUrlPolicy";

export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "link"; text: string; url: string };

export type MarkdownBlock =
  | { type: "heading"; level: number; content: MarkdownInline[] }
  | { type: "paragraph"; content: MarkdownInline[] }
  | { type: "list"; ordered: boolean; items: MarkdownInline[][] };

const BLOCK_START = /^(#{1,6})\s+|^[-+*]\s+|^\d+[.)]\s+/;
const INLINE_TOKEN =
  /(!?\[[^\]]*]\([^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

export function parseSafeMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]?.length ?? 1,
        content: parseInline(heading[2] ?? ""),
      });
      index += 1;
      continue;
    }
    const ordered = /^\d+[.)]\s+/.test(line);
    const unordered = /^[-+*]\s+/.test(line);
    if (ordered || unordered) {
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const match = ordered
          ? current.match(/^\d+[.)]\s+(.+)$/)
          : current.match(/^[-+*]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(parseInline(match[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length
      && lines[index]?.trim()
      && !BLOCK_START.test(lines[index] ?? "")
    ) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({
      type: "paragraph",
      content: parseInline(paragraphLines.join(" ")),
    });
  }
  return blocks;
}

export function parseInline(source: string): MarkdownInline[] {
  const result: MarkdownInline[] = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      result.push({ type: "text", text: source.slice(cursor, start) });
    }
    if (token.startsWith("![")) {
      const imageMatch = token.match(/^!\[([^\]]*)]\([^)]+\)$/);
      result.push({
        type: "text",
        text: imageMatch?.[1]?.trim() || "Image",
      });
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)]\(([^)]+)\)$/);
      const label = linkMatch?.[1] ?? token;
      const safeUrl = sanitizeTrainingContentLink(linkMatch?.[2] ?? "", {
        allowMailto: true,
      });
      result.push(
        safeUrl
          ? { type: "link", text: label, url: safeUrl }
          : { type: "text", text: label }
      );
    } else if (
      (token.startsWith("**") && token.endsWith("**"))
      || (token.startsWith("__") && token.endsWith("__"))
    ) {
      result.push({ type: "bold", text: token.slice(2, -2) });
    } else {
      result.push({ type: "italic", text: token.slice(1, -1) });
    }
    cursor = start + token.length;
  }
  if (cursor < source.length) {
    result.push({ type: "text", text: source.slice(cursor) });
  }
  return result;
}
