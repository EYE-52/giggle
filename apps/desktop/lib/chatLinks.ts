export type ChatTextPart = { text: string; href?: string };

/** Keep messages as escaped text; only explicit web URLs become links. */
export function chatTextParts(text: string): ChatTextPart[] {
  const parts: ChatTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let url = match[0].replace(/[.,!?;:]+$/, "");
    while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1);
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || parsed.username || parsed.password) continue;
    } catch { continue; }
    const start = match.index!;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: url, href: url });
    cursor = start + url.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
