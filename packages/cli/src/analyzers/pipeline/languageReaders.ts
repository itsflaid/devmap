import type { SymbolInfo } from "../analysis/index.js";

export interface LanguageReading {
  imports: string[];
  symbols: SymbolInfo[];
}

interface CommentSyntax {
  line: string[];
  block?: [string, string];
  /** Python-style triple-quoted strings are blanked too: they are docstrings. */
  tripleQuotes?: boolean;
  /** Ruby =begin/=end block comments. */
  rubyBlock?: boolean;
  quotes: string[];
}

const C_LIKE: CommentSyntax = { line: ["//"], block: ["/*", "*/"], quotes: ['"', "'"] };

const SYNTAX: Record<string, CommentSyntax> = {
  ".py": { line: ["#"], tripleQuotes: true, quotes: ['"', "'"] },
  ".rb": { line: ["#"], rubyBlock: true, quotes: ['"', "'"] },
  ".php": { line: ["//", "#"], block: ["/*", "*/"], quotes: ['"', "'"] },
  ".go": { line: ["//"], block: ["/*", "*/"], quotes: ['"', "'", "`"] },
  ".cs": C_LIKE,
  ".java": C_LIKE
};

export function supportsLanguageReader(extension: string): boolean {
  return extension in SYNTAX;
}

export function readLanguage(extension: string, content: string): LanguageReading {
  const syntax = SYNTAX[extension];
  const code = stripComments(content, syntax);

  switch (extension) {
    case ".py": return readPython(code);
    case ".rb": return readRuby(code);
    case ".php": return readPhp(code);
    case ".go": return readGo(code);
    case ".cs": return readCSharp(code);
    default: return readJava(code);
  }
}

/**
 * Blank out comments (and Python docstrings) while keeping every newline and
 * string literal, so offsets and line numbers stay valid and `#` or `//` inside
 * a string is not mistaken for a comment.
 */
function stripComments(content: string, syntax: CommentSyntax): string {
  const out: string[] = [];
  let index = 0;

  const blank = (text: string) => text.replace(/[^\n]/g, " ");

  while (index < content.length) {
    const rest = content.slice(index, index + 3);

    if (syntax.rubyBlock && content.startsWith("=begin", index) && (index === 0 || content[index - 1] === "\n")) {
      const end = content.indexOf("\n=end", index);
      const stop = end === -1 ? content.length : end + 5;
      out.push(blank(content.slice(index, stop)));
      index = stop;
      continue;
    }

    if (syntax.tripleQuotes && (rest === '"""' || rest === "'''")) {
      const end = content.indexOf(rest, index + 3);
      const stop = end === -1 ? content.length : end + 3;
      out.push(blank(content.slice(index, stop)));
      index = stop;
      continue;
    }

    if (syntax.block && content.startsWith(syntax.block[0], index)) {
      const end = content.indexOf(syntax.block[1], index + syntax.block[0].length);
      const stop = end === -1 ? content.length : end + syntax.block[1].length;
      out.push(blank(content.slice(index, stop)));
      index = stop;
      continue;
    }

    const lineMarker = syntax.line.find((marker) => content.startsWith(marker, index));
    if (lineMarker) {
      const end = content.indexOf("\n", index);
      const stop = end === -1 ? content.length : end;
      out.push(blank(content.slice(index, stop)));
      index = stop;
      continue;
    }

    const character = content[index];
    if (syntax.quotes.includes(character)) {
      let cursor = index + 1;
      // Backtick (Go raw) strings may span lines and do not escape.
      const multiline = character === "`";
      while (cursor < content.length && content[cursor] !== character) {
        if (content[cursor] === "\\" && !multiline) cursor += 1;
        else if (content[cursor] === "\n" && !multiline) break;
        cursor += 1;
      }
      const stop = Math.min(cursor + 1, content.length);
      out.push(content.slice(index, stop));
      index = stop;
      continue;
    }

    out.push(character);
    index += 1;
  }

  return out.join("");
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function matchAll(content: string, pattern: RegExp): RegExpExecArray[] {
  return [...content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
}

// ------------------------------------------------------------------- Python

function readPython(code: string): LanguageReading {
  const imports = new Set<string>();
  const symbols: SymbolInfo[] = [];
  const starts = lineStarts(code);

  for (const match of matchAll(code, /^[ \t]*import[ \t]+([^\n;#]+)/m)) {
    for (const part of match[1].split(",")) {
      const module = part.trim().split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_][\w.]*$/.test(module)) imports.add(module);
    }
  }

  for (const match of matchAll(code, /^[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+([^\n;#]*)/m)) {
    const dots = match[1].length;
    const module = match[2] ?? "";

    if (dots === 0) {
      if (module) imports.add(module);
      continue;
    }

    // Relative imports become path-style specifiers the graph can resolve:
    // `.models` -> ./models, `..core.db` -> ../core/db.
    const base = dots === 1 ? "./" : "../".repeat(dots - 1);
    if (module) {
      imports.add(`${base}${module.replace(/\./g, "/")}`);
    } else {
      // `from . import views, forms` imports sibling modules.
      for (const part of match[3].replace(/[()]/g, "").split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_]\w*$/.test(name)) imports.add(`${base}${name}`);
      }
    }
  }

  for (const match of matchAll(code, /^([ \t]*)(async[ \t]+)?(def|class)[ \t]+([A-Za-z_]\w*)/m)) {
    const indented = match[1].length > 0;
    const name = match[4];
    const isClass = match[3] === "class";

    symbols.push({
      name,
      kind: isClass ? "class" : indented ? "method" : "function",
      line: lineAt(starts, match.index),
      // Python has no export keyword: public top-level names are the module API.
      exported: !indented && !name.startsWith("_"),
      ...(isClass ? {} : { async: Boolean(match[2]) })
    });
  }

  return { imports: [...imports], symbols };
}

// --------------------------------------------------------------------- Ruby

function readRuby(code: string): LanguageReading {
  const imports = new Set<string>();
  const symbols: SymbolInfo[] = [];
  const starts = lineStarts(code);

  for (const match of matchAll(code, /^[ \t]*(require_relative|require|load)[ \t(]+['"]([^'"]+)['"]/m)) {
    const specifier = match[2];
    if (match[1] === "require_relative") {
      imports.add(specifier.startsWith(".") ? specifier : `./${specifier}`);
    } else {
      imports.add(specifier);
    }
  }

  for (const match of matchAll(code, /^([ \t]*)(class|module|def)[ \t]+(self\.)?([A-Za-z_][\w:]*[?!=]?)/m)) {
    const indented = match[1].length > 0;
    const keyword = match[2];
    const kind: SymbolInfo["kind"] = keyword === "def" ? (indented ? "method" : "function") : "class";

    symbols.push({
      name: match[4],
      kind,
      line: lineAt(starts, match.index),
      exported: keyword !== "def" || !indented,
      ...(keyword === "def" ? { async: false } : {})
    });
  }

  return { imports: [...imports], symbols };
}

// ---------------------------------------------------------------------- PHP

function readPhp(code: string): LanguageReading {
  const imports = new Set<string>();
  const symbols: SymbolInfo[] = [];
  const starts = lineStarts(code);

  for (const match of matchAll(code, /^[ \t]*use[ \t]+(?:function[ \t]+|const[ \t]+)?([A-Za-z_\\][\w\\]*)(?:[ \t]+as[ \t]+\w+)?[ \t]*;/m)) {
    imports.add(match[1].replace(/^\\/, ""));
  }

  for (const match of matchAll(code, /\b(?:require|include)(?:_once)?[ \t]*\(?[ \t]*(__DIR__[ \t]*\.[ \t]*)?['"]([^'"]+\.php)['"]/)) {
    const path = match[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) continue;
    if (match[1]) imports.add(`./${path.replace(/^\//, "")}`);
    else imports.add(path.startsWith(".") ? path : `./${path}`);
  }

  for (const match of matchAll(code, /^[ \t]*(?:(?:abstract|final|readonly)[ \t]+)*(class|interface|trait|enum)[ \t]+([A-Za-z_]\w*)/m)) {
    symbols.push({
      name: match[2],
      kind: match[1] === "interface" ? "interface" : match[1] === "enum" ? "enum" : "class",
      line: lineAt(starts, match.index),
      exported: true
    });
  }

  for (const match of matchAll(code, /^([ \t]*)(?:(?:public|protected|private|static|abstract|final)[ \t]+)*function[ \t]+&?([A-Za-z_]\w*)/m)) {
    const indented = match[1].length > 0;
    symbols.push({
      name: match[2],
      kind: indented ? "method" : "function",
      line: lineAt(starts, match.index),
      exported: !indented,
      async: false
    });
  }

  return { imports: [...imports], symbols: symbols.sort(byLine) };
}

// ----------------------------------------------------------------------- Go

function readGo(code: string): LanguageReading {
  const imports = new Set<string>();
  const symbols: SymbolInfo[] = [];
  const starts = lineStarts(code);

  for (const match of matchAll(code, /^import[ \t]+(?:[\w.]+[ \t]+)?"([^"]+)"/m)) {
    imports.add(match[1]);
  }
  for (const block of matchAll(code, /^import[ \t]*\(([^)]*)\)/m)) {
    for (const entry of matchAll(block[1], /^[ \t]*(?:[\w.]+[ \t]+)?"([^"]+)"/m)) {
      imports.add(entry[1]);
    }
  }

  for (const match of matchAll(code, /^func[ \t]+(\([^)]*\)[ \t]*)?([A-Za-z_]\w*)/m)) {
    symbols.push({
      name: match[2],
      kind: match[1] ? "method" : "function",
      line: lineAt(starts, match.index),
      exported: /^[A-Z]/.test(match[2]),
      async: false
    });
  }

  for (const match of matchAll(code, /^type[ \t]+([A-Za-z_]\w*)[ \t]+(struct|interface)?/m)) {
    symbols.push({
      name: match[1],
      kind: match[2] === "interface" ? "interface" : match[2] === "struct" ? "class" : "type",
      line: lineAt(starts, match.index),
      exported: /^[A-Z]/.test(match[1])
    });
  }

  return { imports: [...imports], symbols: symbols.sort(byLine) };
}

// ------------------------------------------------------------ C# and Java

function readCSharp(code: string): LanguageReading {
  const imports = new Set<string>();
  const starts = lineStarts(code);
  const symbols: SymbolInfo[] = [];

  // `using System;` / `using static X.Y;` / `using Alias = X.Y;` but not `using (var x = ...)`.
  for (const match of matchAll(code, /^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([A-Za-z_][\w.]*)[ \t]*;/m)) {
    imports.add(match[1]);
  }

  for (const match of matchAll(code, /^[ \t]*((?:(?:public|internal|private|protected|static|abstract|sealed|partial|readonly)[ \t]+)*)(class|interface|struct|enum|record)[ \t]+([A-Za-z_]\w*)/m)) {
    symbols.push({
      name: match[3],
      kind: match[2] === "interface" ? "interface" : match[2] === "enum" ? "enum" : "class",
      line: lineAt(starts, match.index),
      exported: /\bpublic\b/.test(match[1])
    });
  }

  return { imports: [...imports], symbols };
}

function readJava(code: string): LanguageReading {
  const imports = new Set<string>();
  const starts = lineStarts(code);
  const symbols: SymbolInfo[] = [];

  for (const match of matchAll(code, /^[ \t]*import[ \t]+(?:static[ \t]+)?([A-Za-z_][\w.]*(?:\.\*)?)[ \t]*;/m)) {
    imports.add(match[1]);
  }

  for (const match of matchAll(code, /^[ \t]*((?:(?:public|private|protected|static|abstract|final|sealed)[ \t]+)*)(class|interface|enum|record|@interface)[ \t]+([A-Za-z_]\w*)/m)) {
    symbols.push({
      name: match[3],
      kind: match[2] === "interface" || match[2] === "@interface" ? "interface" : match[2] === "enum" ? "enum" : "class",
      line: lineAt(starts, match.index),
      exported: /\bpublic\b/.test(match[1])
    });
  }

  return { imports: [...imports], symbols };
}

function byLine(left: SymbolInfo, right: SymbolInfo): number {
  return left.line - right.line || left.name.localeCompare(right.name);
}
