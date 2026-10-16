import assert from "node:assert/strict";
import test from "node:test";
import type { ScannedFile } from "../src/analyzers/analysis/index.js";
import { buildDependencyGraph } from "../src/analyzers/graph/index.js";
import { HeuristicAnalyzer } from "../src/analyzers/pipeline/heuristicAnalyzer.js";

const analyzer = new HeuristicAnalyzer();

function fileOf(path: string, content: string): ScannedFile {
  const extension = path.slice(path.lastIndexOf("."));
  return { path, absolutePath: `/p/${path}`, extension, size: content.length, lines: content.split("\n").length, content };
}

async function analyze(path: string, content: string) {
  return analyzer.analyze(fileOf(path, content), { projectRoot: "/p" } as never);
}

test("python: imports, relative imports, symbols and visibility", async () => {
  const analysis = await analyze("app/views.py", [
    '"""Views for the app. This class of helpers is documented here."""',
    "import os, sys as system",
    "import json  # import not_real",
    "from app.models import User",
    "from .forms import LoginForm",
    "from ..core.db import session",
    "from . import helpers, utils as u",
    "",
    "def index(request):",
    "    return 1",
    "",
    "async def fetch():",
    "    pass",
    "",
    "def _private():",
    "    pass",
    "",
    "class Page:",
    "    def render(self):",
    "        pass",
    ""
  ].join("\n"));

  assert.deepEqual([...analysis.imports].sort(), [
    "../core/db", "./forms", "./helpers", "./utils", "app.models", "json", "os", "sys"
  ].sort());
  const byName = Object.fromEntries(analysis.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.index.kind, "function");
  assert.equal(byName.index.exported, true);
  assert.equal(byName.fetch.async, true);
  assert.equal(byName._private.exported, false);
  assert.equal(byName.Page.kind, "class");
  assert.equal(byName.render.kind, "method");
  assert.equal(byName.render.exported, false);
  assert.equal(byName.index.line, 9);
  assert.equal(analysis.symbols.some((symbol) => symbol.name === "of"), false, "docstring text is not code");
  assert.deepEqual(analysis.exports, ["Page", "fetch", "index"]);
});

test("python: imports resolve to local modules in the dependency graph", async () => {
  const files = [
    fileOf("manage.py", "from app.models import User\nfrom app import settings\n"),
    fileOf("app/__init__.py", ""),
    fileOf("app/models.py", "from .base import Base\n"),
    fileOf("app/base.py", ""),
    fileOf("app/settings.py", ""),
    fileOf("src/lib/util.py", ""),
    fileOf("app/views.py", "import lib.util\nimport os\n")
  ];
  const analyses = Object.fromEntries(await Promise.all(files.map(
    async (file) => [file.path, await analyzer.analyze(file, { projectRoot: "/p" } as never)] as const
  )));
  const { graph } = buildDependencyGraph(files, analyses);

  assert.deepEqual(graph["manage.py"], ["app/models.py", "app/__init__.py"]);
  assert.deepEqual(graph["app/models.py"], ["app/base.py"]);
  assert.deepEqual(graph["app/views.py"], ["src/lib/util.py"]);
});

test("ruby: require, require_relative, classes and methods", async () => {
  const analysis = await analyze("lib/user.rb", [
    "# require 'commented'",
    "require 'json'",
    "require_relative 'base'",
    "module Accounts",
    "  class User < Base",
    "    def self.find(id)",
    "    end",
    "    def name",
    "    end",
    "  end",
    "end",
    "def helper",
    "end"
  ].join("\n"));

  assert.deepEqual(analysis.imports, ["json", "./base"]);
  const names = analysis.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);
  assert.deepEqual(names, [
    "class:Accounts", "class:User", "method:find", "method:name", "function:helper"
  ]);
});

test("php: use statements, relative requires and declarations", async () => {
  const analysis = await analyze("src/Controller.php", [
    "<?php",
    "namespace App;",
    "use App\\Models\\User;",
    "use Illuminate\\Support\\Facades\\DB as Database;",
    "// use Not\\Real;",
    "require_once __DIR__ . '/helpers.php';",
    "require 'config/app.php';",
    "final class Controller {",
    "    public function show() {}",
    "}",
    "interface Handler {}",
    "function boot() {}"
  ].join("\n"));

  assert.deepEqual([...analysis.imports].sort(), [
    "./config/app.php", "./helpers.php", "App\\Models\\User", "Illuminate\\Support\\Facades\\DB"
  ].sort());
  const byName = Object.fromEntries(analysis.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.Controller.kind, "class");
  assert.equal(byName.Handler.kind, "interface");
  assert.equal(byName.show.kind, "method");
  assert.equal(byName.boot.kind, "function");
});

test("go: single and block imports, exported funcs, methods and types", async () => {
  const analysis = await analyze("cmd/server/main.go", [
    "package main",
    "",
    'import "fmt"',
    "import (",
    '\t"net/http"',
    '\tlog "github.com/sirupsen/logrus"',
    '\t// "commented/out"',
    ")",
    "",
    "type Server struct{}",
    "type Handler interface{}",
    "func (s *Server) Start() {}",
    "func main() {}",
    "func Run() {}"
  ].join("\n"));

  assert.deepEqual([...analysis.imports].sort(), ["fmt", "github.com/sirupsen/logrus", "net/http"]);
  const byName = Object.fromEntries(analysis.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.Server.kind, "class");
  assert.equal(byName.Server.exported, true);
  assert.equal(byName.Handler.kind, "interface");
  assert.equal(byName.Start.kind, "method");
  assert.equal(byName.main.exported, false);
  assert.equal(byName.Run.exported, true);
});

test("c#: using directives and public types, ignoring using statements", async () => {
  const analysis = await analyze("Services/OrderService.cs", [
    "using System;",
    "using System.Collections.Generic;",
    "using static System.Math;",
    "namespace Shop.Services {",
    "  public class OrderService {",
    "    void Run() { using (var scope = Create()) { } }",
    "  }",
    "  internal interface IHidden {}",
    "}"
  ].join("\n"));

  assert.deepEqual(analysis.imports, ["System", "System.Collections.Generic", "System.Math"]);
  const byName = Object.fromEntries(analysis.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.OrderService.exported, true);
  assert.equal(byName.IHidden.exported, false);
});

test("java: imports and public types", async () => {
  const analysis = await analyze("src/main/java/Foo.java", [
    "package demo;",
    "import java.util.List;",
    "import static org.junit.Assert.*;",
    "// import java.io.File;",
    "public class Foo {}",
    "interface Bar {}",
    "public enum Mode { A }"
  ].join("\n"));

  assert.deepEqual(analysis.imports, ["java.util.List", "org.junit.Assert.*"]);
  const byName = Object.fromEntries(analysis.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(byName.Foo.exported, true);
  assert.equal(byName.Bar.exported, false);
  assert.equal(byName.Mode.kind, "enum");
});

test("comment markers inside string literals do not hide code", async () => {
  const analysis = await analyze("main.go", [
    'var url = "http://example.com" // trailing',
    "func Real() {}"
  ].join("\n"));
  assert.deepEqual(analysis.symbols.map((symbol) => symbol.name), ["Real"]);
});

test("javascript-family files handled by the heuristic analyzer still find dynamic imports", async () => {
  const analysis = await analyze("lib/loader.mjs", 'export const load = () => import("./page.mjs");\nconst fs = require("node:fs");\n');
  assert.deepEqual([...analysis.imports].sort(), ["./page.mjs", "node:fs"]);
  assert.equal(analysis.symbols.find((symbol) => symbol.name === "load")?.exported, true);
});
