export type MarkdownRenderOptions = {
  width?: number;
  colors?: boolean;
};

const ANSI = {
  aqua: "\x1b[38;2;46;230;214m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
  reset: "\x1b[0m"
};

export function renderTerminalMarkdown(
  markdown: string,
  options: MarkdownRenderOptions = {}
): string {
  const width = Math.max(32, options.width ?? 80);
  const colors = options.colors ?? true;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const rendered: string[] = [];
  let index = 0;
  let inCodeBlock = false;

  while (index < lines.length) {
    const line = lines[index];

    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      index += 1;
      continue;
    }

    if (inCodeBlock) {
      rendered.push(style(`  ${line}`, "gray", colors));
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableEnd = findTableEnd(lines, index);
      rendered.push(...renderTable(lines.slice(index, tableEnd), width, colors));
      index = tableEnd;
      continue;
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = cleanInline(heading[1]);
      rendered.push(style(title, "heading", colors));
      rendered.push(style("-".repeat(Math.min(width, Math.max(12, title.length))), "gray", colors));
      index += 1;
      continue;
    }

    const listItem = line.match(/^(\s*)([-+*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      const marker = /^\d/.test(listItem[2]) ? listItem[2] : "-";
      const indent = listItem[1].length + (marker === "-" ? 0 : 0);
      rendered.push(...wrapWithPrefix(
        cleanInline(listItem[3]),
        `${" ".repeat(indent)}${marker} `,
        width
      ));
      index += 1;
      continue;
    }

    if (line.trim() === "") {
      if (rendered.at(-1) !== "") {
        rendered.push("");
      }
      index += 1;
      continue;
    }

    rendered.push(...wrapText(cleanInline(line.trim()), width));
    index += 1;
  }

  return trimBlankLines(rendered).join("\n");
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    index + 1 < lines.length
    && lines[index].includes("|")
    && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])
  );
}

function findTableEnd(lines: string[], start: number): number {
  let index = start + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
    index += 1;
  }
  return index;
}

function renderTable(
  tableLines: string[],
  width: number,
  colors: boolean
): string[] {
  const headers = parseTableRow(tableLines[0]).map(cleanInline);
  const rows = tableLines.slice(2).map((line) => parseTableRow(line).map(cleanInline));
  const labelWidth = Math.min(
    18,
    Math.max(8, ...headers.slice(1).map((header) => header.length))
  );
  const rendered: string[] = [];

  for (const row of rows) {
    const title = row[0] || "Item";
    rendered.push(style(title, "heading", colors));

    for (let index = 1; index < headers.length; index += 1) {
      const label = headers[index] || `Column ${index + 1}`;
      const value = row[index] || "-";
      rendered.push(...wrapWithPrefix(value, `  ${label.padEnd(labelWidth)}  `, width));
    }

    rendered.push("");
  }

  return trimBlankLines(rendered);
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function cleanInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, "$1");
}

function wrapText(value: string, width: number): string[] {
  return wrapWithPrefix(value, "", width);
}

function wrapWithPrefix(value: string, prefix: string, width: number): string[] {
  const continuation = " ".repeat(prefix.length);
  const available = Math.max(12, width - prefix.length);
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= available) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(`${lines.length === 0 ? prefix : continuation}${current}`);
    current = word;
  }

  if (current || lines.length === 0) {
    lines.push(`${lines.length === 0 ? prefix : continuation}${current}`);
  }

  return lines;
}

function style(
  value: string,
  tone: "heading" | "gray",
  colors: boolean
): string {
  if (!colors) {
    return value;
  }

  if (tone === "heading") {
    return `${ANSI.bold}${ANSI.aqua}${value}${ANSI.reset}`;
  }

  return `${ANSI.gray}${value}${ANSI.reset}`;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start] === "") {
    start += 1;
  }

  while (end > start && lines[end - 1] === "") {
    end -= 1;
  }

  return lines.slice(start, end);
}
