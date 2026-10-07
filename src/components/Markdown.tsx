import { ReactNode } from "react";

/**
 * A small, safe Markdown subset for knowledge-base articles: headings, lists,
 * numbered steps, code blocks, bold, italic, inline code and https links.
 * It builds React elements directly, so article text can never inject HTML.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("`")) parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      parts.push(<a key={key} href={match[2]} target="_blank" rel="noopener noreferrer">{label}</a>);
    } else parts.push(<a key={key} href={token} target="_blank" rel="noopener noreferrer">{token}</a>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i += 1; }
      i += 1;
      blocks.push(<pre key={blocks.length} className="code-block">{code.join("\n")}</pre>);
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h${blocks.length}`);
      blocks.push(level === 1 ? <h2 key={blocks.length}>{content}</h2> : level === 2 ? <h3 key={blocks.length}>{content}</h3> : <h4 key={blocks.length}>{content}</h4>);
      i += 1;
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, "")); i += 1; }
      const children = items.map((item, n) => <li key={n}>{inline(item, `l${blocks.length}-${n}`)}</li>);
      blocks.push(ordered ? <ol key={blocks.length}>{children}</ol> : <ul key={blocks.length}>{children}</ul>);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\s*([-*]|\d+[.)])\s+)/.test(lines[i])) { paragraph.push(lines[i]); i += 1; }
    blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "), `p${blocks.length}`)}</p>);
  }
  return <div className="markdown">{blocks}</div>;
}
