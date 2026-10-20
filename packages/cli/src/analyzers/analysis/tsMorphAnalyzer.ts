import {
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  VariableDeclarationKind,
  type SourceFile
} from "ts-morph";
import type {
  AnalyzerContext,
  FileAnalysis,
  FileAnalyzer,
  FunctionInfo,
  SymbolInfo
} from "./fileAnalysis.js";
import type { ScannedFile } from "./fileScanner.js";
import { AstroPreprocessor, SveltePreprocessor, VuePreprocessor } from "./preprocessors/index.js";
import type { LanguagePreprocessor } from "./preprocessors/index.js";

// Native extensions — ts-morph parses these directly, no preprocessing needed.
const NATIVE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// Preprocessors handle files that contain embedded JS/TS inside a larger format.
// Order matters only for logging — each preprocessor's extensions are disjoint.
const PREPROCESSORS: LanguagePreprocessor[] = [
  new VuePreprocessor(),    // .vue  (also covers Nuxt)
  new SveltePreprocessor(), // .svelte (also covers SvelteKit)
  new AstroPreprocessor(),  // .astro
];

// All extensions this analyzer can handle (native + preprocessed)
const ALL_SUPPORTED_EXTENSIONS = new Set([
  ...NATIVE_EXTENSIONS,
  ...PREPROCESSORS.flatMap((p) => p.extensions),
]);

export class TsMorphAnalyzer implements FileAnalyzer {
  readonly id = "ts-morph";
  private readonly project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      target: ScriptTarget.ES2022
    }
  });

  supports(file: ScannedFile): boolean {
    return ALL_SUPPORTED_EXTENSIONS.has(file.extension);
  }

  async analyze(file: ScannedFile, _context: AnalyzerContext): Promise<FileAnalysis> {
    // Native TS/JS files — parse directly
    if (NATIVE_EXTENSIONS.has(file.extension)) {
      return this.analyzeSource(file.path, file.content, file.path);
    }

    // Non-native files — find the right preprocessor and extract script block
    const preprocessor = PREPROCESSORS.find((p) => p.extensions.includes(file.extension));
    if (!preprocessor) {
      // Should never happen since supports() gates this, but safety fallback
      return emptyAnalysis(this.id, "medium");
    }

    const extracted = preprocessor.extract(file.content, file.path);
    if (!extracted) {
      // Valid case: template-only file with no script block (e.g. markup-only .astro)
      // Return empty medium-confidence analysis rather than erroring.
      return emptyAnalysis(this.id, "medium");
    }

    // Build a virtual path with the correct extension so ts-morph applies
    // the right parser (TSX for Vue components, TS for Astro frontmatter, etc.)
    const ext = extracted.virtualExtension ?? (extracted.language === "ts" ? ".ts" : ".js");
    const virtualPath = replaceExtension(file.path, ext);

    return this.analyzeSource(virtualPath, extracted.code, file.path);
  }

  private analyzeSource(
    parsePath: string,
    content: string,
    _originalPath: string
  ): FileAnalysis {
    const sourceFile = this.project.createSourceFile(parsePath, content, { overwrite: true });

    // --- Imports ---
    const imports = new Set<string>();

    for (const declaration of sourceFile.getImportDeclarations()) {
      imports.add(declaration.getModuleSpecifierValue());
    }
    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier) imports.add(specifier);
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      // require("x") and dynamic import("x"); lazy routes and code splitting
      // are only reachable through the latter.
      if (callee.getKind() !== SyntaxKind.ImportKeyword && callee.getText() !== "require") continue;
      const argument = call.getArguments()[0];
      if (argument && (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))) {
        imports.add(argument.getLiteralValue());
      }
    }
    for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
      const reference = declaration.getModuleReference();
      if (Node.isExternalModuleReference(reference)) {
        const expression = reference.getExpression();
        if (expression && Node.isStringLiteral(expression)) imports.add(expression.getLiteralValue());
      }
    }
    for (const importType of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
      const argument = importType.getArgument();
      if (Node.isLiteralTypeNode(argument)) {
        const literal = argument.getLiteral();
        if (Node.isStringLiteral(literal)) imports.add(literal.getLiteralValue());
      }
    }

    // --- Exports ---
    // `module.exports = { a, b }` and `exports.c = ...` are what most Node
    // packages and older JS codebases export; the ESM view above sees none of it.
    const commonJs = readCommonJsExports(sourceFile);
    const exports = [...new Set([
      ...sourceFile.getExportedDeclarations().keys(),
      ...commonJs.map((entry) => entry.name)
    ])].sort();

    // --- Symbols ---
    const symbols: SymbolInfo[] = [];

    for (const statement of sourceFile.getStatements()) {
      if (Node.isFunctionDeclaration(statement) && statement.getName()) {
        // Overload signatures share the implementation's name; list it once.
        if (statement.isOverload()) continue;
        symbols.push({
          name: statement.getNameOrThrow(),
          kind: "function",
          line: statement.getStartLineNumber(),
          exported: statement.isExported() || statement.isDefaultExport(),
          async: statement.isAsync()
        });
        continue;
      }

      if (Node.isClassDeclaration(statement) && statement.getName()) {
        const classExported = statement.isExported() || statement.isDefaultExport();
        symbols.push({
          name: statement.getNameOrThrow(),
          kind: "class",
          line: statement.getStartLineNumber(),
          exported: classExported
        });
        for (const method of statement.getMethods()) {
          if (method.isOverload()) continue;
          symbols.push({
            name: method.getName(),
            kind: "method",
            line: method.getStartLineNumber(),
            exported: false,
            async: method.isAsync()
          });
        }
        continue;
      }

      if (Node.isInterfaceDeclaration(statement)) {
        symbols.push(createDeclarationSymbol(statement, "interface"));
        continue;
      }

      if (Node.isTypeAliasDeclaration(statement)) {
        symbols.push(createDeclarationSymbol(statement, "type"));
        continue;
      }

      if (Node.isEnumDeclaration(statement)) {
        symbols.push(createDeclarationSymbol(statement, "enum"));
        continue;
      }

      if (
        Node.isVariableStatement(statement)
        && statement.getDeclarationKind() === VariableDeclarationKind.Const
      ) {
        for (const declaration of statement.getDeclarations()) {
          const initializer = declaration.getInitializer();
          const isAsyncFunction = Boolean(
            initializer
            && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
            && initializer.isAsync()
          );
          // `const { a, b } = x` declares a and b, not a symbol named "{ a, b }".
          for (const name of declaredNames(declaration.getNameNode())) {
            symbols.push({
              name,
              kind: "const",
              line: declaration.getStartLineNumber(),
              exported: statement.isExported(),
              async: isAsyncFunction
            });
          }
        }
      }
    }

    for (const entry of commonJs) {
      const existing = symbols.find((symbol) => symbol.name === (entry.alias ?? entry.name));
      if (existing) {
        existing.exported = true;
      } else if (entry.name !== "default") {
        symbols.push({
          name: entry.name,
          kind: entry.kind,
          line: entry.line,
          exported: true,
          async: entry.async
        });
      }
    }
    symbols.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));

    // --- Top functions ---
    const topFunctions = symbols
      .filter((symbol): symbol is SymbolInfo & { kind: FunctionInfo["kind"] } =>
        ["function", "const", "class", "method"].includes(symbol.kind)
      )
      .map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        exported: symbol.exported,
        async: symbol.async ?? false
      }))
      .sort(compareFunctions)
      .slice(0, 8);

    this.project.removeSourceFile(sourceFile);

    return {
      analyzer: this.id,
      confidence: "high",
      imports: [...imports],
      exports,
      symbols,
      topFunctions
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function declaredNames(nameNode: Node): string[] {
  if (Node.isIdentifier(nameNode)) return [nameNode.getText()];
  return nameNode
    .getDescendantsOfKind(SyntaxKind.BindingElement)
    .map((element) => element.getNameNode())
    .filter((node) => Node.isIdentifier(node))
    .map((node) => node.getText());
}

interface CommonJsExport {
  name: string;
  /** `module.exports = router`: the local binding the default export points at. */
  alias?: string;
  kind: "function" | "const";
  line: number;
  async: boolean;
}

/**
 * Top-level `module.exports = ...`, `module.exports.x = ...` and `exports.x = ...`.
 * An object literal contributes its keys; anything else is the default export.
 */
function readCommonJsExports(sourceFile: SourceFile): CommonJsExport[] {
  const found: CommonJsExport[] = [];
  const seen = new Set<string>();

  const add = (name: string, node: Node, value?: Node) => {
    if (seen.has(name)) return;
    seen.add(name);
    const callable = value && (
      Node.isFunctionExpression(value) || Node.isArrowFunction(value) || Node.isMethodDeclaration(value)
    );
    found.push({
      name,
      ...(name === "default" && value && Node.isIdentifier(value) ? { alias: value.getText() } : {}),
      kind: callable || (value && Node.isClassExpression(value)) ? "function" : "const",
      line: node.getStartLineNumber(),
      async: Boolean(callable && (value as { isAsync(): boolean }).isAsync())
    });
  };

  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expression = statement.getExpression();
    if (!Node.isBinaryExpression(expression)) continue;
    if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

    const target = commonJsTarget(expression.getLeft());
    if (!target) continue;
    const value = expression.getRight();

    if (target.kind === "named") {
      add(target.name, statement, value);
      continue;
    }

    if (Node.isObjectLiteralExpression(value)) {
      for (const property of value.getProperties()) {
        if (Node.isPropertyAssignment(property)) {
          add(property.getName().replace(/^['"]|['"]$/g, ""), property, property.getInitializer());
        } else if (Node.isShorthandPropertyAssignment(property)) {
          add(property.getName(), property);
        } else if (Node.isMethodDeclaration(property)) {
          add(property.getName(), property, property);
        }
      }
    } else {
      add("default", statement, value);
    }
  }

  return found;
}

function commonJsTarget(left: Node): { kind: "all" } | { kind: "named"; name: string } | null {
  const isExportsObject = (node: Node) => ["module.exports", "exports"].includes(node.getText());

  if (Node.isPropertyAccessExpression(left)) {
    if (left.getText() === "module.exports") return { kind: "all" };
    if (isExportsObject(left.getExpression())) return { kind: "named", name: left.getName() };
    return null;
  }

  if (Node.isElementAccessExpression(left) && isExportsObject(left.getExpression())) {
    const argument = left.getArgumentExpression();
    if (argument && Node.isStringLiteral(argument)) return { kind: "named", name: argument.getLiteralValue() };
  }

  return null;
}

function replaceExtension(filePath: string, newExt: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return filePath + newExt;
  return filePath.slice(0, lastDot) + newExt;
}

function emptyAnalysis(
  analyzerId: string,
  confidence: FileAnalysis["confidence"]
): FileAnalysis {
  return {
    analyzer: analyzerId,
    confidence,
    imports: [],
    exports: [],
    symbols: [],
    topFunctions: []
  };
}

function createDeclarationSymbol(
  declaration: {
    getName(): string;
    getStartLineNumber(): number;
    isExported(): boolean;
    isDefaultExport(): boolean;
  },
  kind: "interface" | "type" | "enum"
): SymbolInfo {
  return {
    name: declaration.getName(),
    kind,
    line: declaration.getStartLineNumber(),
    exported: declaration.isExported() || declaration.isDefaultExport()
  };
}

function compareFunctions(left: FunctionInfo, right: FunctionInfo): number {
  return Number(right.exported) - Number(left.exported)
    || left.line - right.line
    || left.name.localeCompare(right.name);
}
