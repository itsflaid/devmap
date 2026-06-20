import {
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  VariableDeclarationKind
} from "ts-morph";
import type {
  AnalyzerContext,
  FileAnalysis,
  FileAnalyzer,
  FunctionInfo,
  SymbolInfo
} from "./fileAnalysis.js";
import type { ScannedFile } from "./fileScanner.js";

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

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
    return SUPPORTED_EXTENSIONS.has(file.extension);
  }

  async analyze(file: ScannedFile, _context: AnalyzerContext): Promise<FileAnalysis> {
    const sourceFile = this.project.createSourceFile(file.path, file.content, { overwrite: true });
    const imports = new Set(
      sourceFile.getImportDeclarations().map((declaration) => declaration.getModuleSpecifierValue())
    );

    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier) imports.add(specifier);
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== "require") continue;
      const argument = call.getArguments()[0];
      if (argument && Node.isStringLiteral(argument)) {
        imports.add(argument.getLiteralValue());
      }
    }

    const exports = [...sourceFile.getExportedDeclarations().keys()].sort();
    const symbols: SymbolInfo[] = [];

    for (const statement of sourceFile.getStatements()) {
      if (Node.isFunctionDeclaration(statement) && statement.getName()) {
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

      if (Node.isVariableStatement(statement)
        && statement.getDeclarationKind() === VariableDeclarationKind.Const) {
        for (const declaration of statement.getDeclarations()) {
          const initializer = declaration.getInitializer();
          symbols.push({
            name: declaration.getName(),
            kind: "const",
            line: declaration.getStartLineNumber(),
            exported: statement.isExported(),
            async: Boolean(
              initializer
              && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
              && initializer.isAsync()
            )
          });
        }
      }
    }

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
