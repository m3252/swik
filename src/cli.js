#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { copyFile, cp, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");

const ROOT = process.cwd();
const SUPPORTED = new Set(["cc", "claude", "claude-code", "codex"]);
const MIGRATION_HEADER = /^# Project Instructions\n\nMigrated from (CLAUDE\.md|AGENTS\.md) by ai-switch\.\n\n/;
const RELATIVE_PATHS = {
  claudeMd: "CLAUDE.md",
  agentsMd: "AGENTS.md",
  mcpJson: ".mcp.json",
  claudeDir: ".claude",
  claudeSettings: path.join(".claude", "settings.json"),
  claudeSkills: path.join(".claude", "skills"),
  codexDir: ".codex",
  codexConfig: path.join(".codex", "config.toml"),
  codexSkills: path.join(".codex", "skills"),
  agentsDir: ".agents",
  agentsSkills: path.join(".agents", "skills"),
  report: "ai-switch-report.md",
  backupDir: ".ai-switch-backups"
};
const GLOBAL_RELATIVE_PATHS = {
  backupDir: path.join(".ai-switch", "backups", "global")
};

function projectPaths(cwd) {
  return Object.fromEntries(Object.entries(RELATIVE_PATHS).map(([key, value]) => [key, path.join(cwd, value)]));
}

function globalPaths(home) {
  return globalPathsFor(home);
}

function globalPathsFor(home, env = process.env) {
  const claudeRoot = path.resolve(env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"));
  const codexRoot = path.resolve(env.CODEX_HOME ?? path.join(home, ".codex"));
  return {
    claudeRoot,
    codexRoot,
    claudeMd: path.join(claudeRoot, RELATIVE_PATHS.claudeMd),
    claudeSettings: path.join(claudeRoot, "settings.json"),
    claudeSkills: path.join(claudeRoot, "skills"),
    agentsMd: path.join(codexRoot, RELATIVE_PATHS.agentsMd),
    codexConfig: path.join(codexRoot, "config.toml"),
    codexSkills: path.join(codexRoot, "skills"),
    // Codex's current (preferred) skill location is ~/.agents/skills, independent
    // of CODEX_HOME; ~/.codex/skills is the deprecated-but-still-read fallback.
    agentsSkills: path.join(home, ".agents", "skills"),
    backupDir: path.join(home, GLOBAL_RELATIVE_PATHS.backupDir),
    report: path.join(home, ".ai-switch", RELATIVE_PATHS.report)
  };
}

// The ONLY global files ai-switch reads or writes. Everything else under
// ~/.claude and ~/.codex (auth.json, sessions/, state_*.sqlite, logs, caches,
// rollouts, vendor_imports, ...) is deliberately untouched. Each entry has a
// stable backup key so backup/restore works regardless of CLAUDE_CONFIG_DIR /
// CODEX_HOME relocation.
function globalAllowlist(files) {
  return [
    { key: "claude/CLAUDE.md", path: files.claudeMd, dir: false },
    { key: "claude/settings.json", path: files.claudeSettings, dir: false },
    { key: "claude/skills", path: files.claudeSkills, dir: true },
    { key: "codex/AGENTS.md", path: files.agentsMd, dir: false },
    { key: "codex/config.toml", path: files.codexConfig, dir: false },
    { key: "codex/skills", path: files.codexSkills, dir: true },
    { key: "agents/skills", path: files.agentsSkills, dir: true }
  ];
}

// Codex reads skills from both .codex/skills and the newer .agents/skills
// (project), and ~/.codex/skills (deprecated) and ~/.agents/skills (preferred,
// global). When migrating into Claude we read every existing source; when
// writing into Codex we target the preferred .agents/skills location.
function codexSkillSources(files) {
  return [files.codexSkills, files.agentsSkills];
}

function skillCopyChanges(sources, target) {
  return sources.filter((source) => existsSync(source)).map((source) => ({ kind: "copy-dir", from: source, path: target }));
}

function countSkillDirs(dirs) {
  return dirs.reduce((total, dir) => total + listDir(dir).length, 0);
}

function usage() {
  return `ai-switch

Usage:
  ai-switch detect [--cwd <path>]
  ai-switch status [--cwd <path>]
  ai-switch status --global [--home <path>]
  ai-switch doctor [--cwd <path>]
  ai-switch backup [--cwd <path>]
  ai-switch backups [--cwd <path>] [--global [--home <path>]]
  ai-switch restore <latest|timestamp> [--cwd <path>] [--force] [--global [--home <path>]]
  ai-switch convert <cc|codex> <cc|codex> [--cwd <path>] [--dry-run] [--yes] [--force]
  ai-switch convert <cc|codex> <cc|codex> --global [--home <path>] [--dry-run] [--yes] [--force]
  ai-switch --version

Examples:
  ai-switch convert cc codex --dry-run
  ai-switch convert cc codex --yes
  ai-switch convert cc codex --yes --force
  ai-switch convert codex cc --yes
  ai-switch status
  ai-switch status --global
  ai-switch convert cc codex --global --dry-run
  ai-switch convert cc codex --global --yes
  ai-switch backups --global
  ai-switch restore latest --global
`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--cwd requires a path value.");
      args.cwd = path.resolve(value);
    }
    else if (arg === "--home") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--home requires a path value.");
      args.home = path.resolve(value);
    }
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--global") args.global = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--version" || arg === "-v") args.version = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else args._.push(arg);
  }
  args.cwd ??= ROOT;
  return args;
}

function normalizeProvider(provider) {
  if (!SUPPORTED.has(provider)) throw new Error(`Unsupported provider: ${provider}`);
  return provider === "codex" ? "codex" : "cc";
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function readJson(file) {
  const text = readText(file);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { __parseError: error.message };
  }
}

function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => path.join(dir, name));
}

function detect(cwd) {
  const files = projectPaths(cwd);

  const claudeSettings = readJson(files.claudeSettings);
  const mcpJson = readJson(files.mcpJson);
  const claudeMcp = analyzeClaudeMcpSources(cwd, { settings: claudeSettings, mcpJson }).servers;

  return {
    cwd,
    claude: {
      instructionFile: existsSync(files.claudeMd) ? files.claudeMd : null,
      settingsFile: existsSync(files.claudeSettings) ? files.claudeSettings : null,
      mcpFile: existsSync(files.mcpJson) ? files.mcpJson : null,
      skillsDir: existsSync(files.claudeSkills) ? files.claudeSkills : null,
      skillCount: listDir(files.claudeSkills).length,
      mcpServerCount: countMcpServers(claudeMcp)
    },
    codex: {
      instructionFile: existsSync(files.agentsMd) ? files.agentsMd : null,
      configFile: existsSync(files.codexConfig) ? files.codexConfig : null,
      skillsDir: existsSync(files.agentsSkills) ? files.agentsSkills : (existsSync(files.codexSkills) ? files.codexSkills : null),
      skillCount: countSkillDirs(codexSkillSources(files)),
      mcpServerCount: countCodexMcpServers(readText(files.codexConfig))
    },
    parseErrors: [
      claudeSettings?.__parseError ? `.claude/settings.json: ${claudeSettings.__parseError}` : null,
      mcpJson?.__parseError ? `.mcp.json: ${mcpJson.__parseError}` : null
    ].filter(Boolean)
  };
}

function detectGlobal(home = homedir(), env = process.env) {
  const files = globalPathsFor(home, env);
  const claudeSettings = readJson(files.claudeSettings);
  const codexConfig = readText(files.codexConfig);
  return {
    home,
    claude: {
      instructionFile: existsSync(files.claudeMd) ? files.claudeMd : null,
      settingsFile: existsSync(files.claudeSettings) ? files.claudeSettings : null,
      skillsDir: existsSync(files.claudeSkills) ? files.claudeSkills : null,
      skillCount: listDir(files.claudeSkills).length,
      mcpServerCount: countMcpServers(claudeSettings?.__parseError ? undefined : claudeSettings?.mcpServers)
    },
    codex: {
      instructionFile: existsSync(files.agentsMd) ? files.agentsMd : null,
      configFile: existsSync(files.codexConfig) ? files.codexConfig : null,
      skillsDir: existsSync(files.agentsSkills) ? files.agentsSkills : (existsSync(files.codexSkills) ? files.codexSkills : null),
      skillCount: countSkillDirs(codexSkillSources(files)),
      mcpServerCount: countCodexMcpServers(codexConfig)
    },
    parseErrors: [
      claudeSettings?.__parseError ? `${formatDisplayPath(home, files.claudeSettings)}: ${claudeSettings.__parseError}` : null
    ].filter(Boolean)
  };
}

function countMcpServers(servers) {
  return servers && typeof servers === "object" ? Object.keys(servers).length : 0;
}

function countCodexMcpServers(toml) {
  if (!toml) return 0;
  return [...toml.matchAll(/^\[mcp_servers\."?([^"\]\n]+)"?\]/gm)].length;
}

function codexMcpNames(toml) {
  if (!toml) return new Set();
  return new Set([...toml.matchAll(/^\[mcp_servers\."?([^"\]\n]+)"?\]/gm)].map((match) => match[1]));
}

function extractClaudeMcp(cwd) {
  return analyzeClaudeMcpSources(cwd).servers;
}

function analyzeClaudeMcpSources(cwd, parsed = {}) {
  const files = projectPaths(cwd);
  const settings = parsed.settings ?? readJson(files.claudeSettings);
  const mcpJson = parsed.mcpJson ?? readJson(files.mcpJson);
  const servers = {};
  const manualReviews = [];
  const planItems = [];

  for (const [sourceName, sourceServers] of [
    [".claude/settings.json", settings?.__parseError ? undefined : settings?.mcpServers],
    [".mcp.json", mcpJson?.__parseError ? undefined : mcpJson?.mcpServers]
  ]) {
    if (!sourceServers || typeof sourceServers !== "object") continue;
    for (const [name, server] of Object.entries(sourceServers)) {
      if (Object.hasOwn(servers, name)) {
        manualReviews.push(`Claude MCP server "${name}" exists in multiple Claude MCP sources; kept the first value and skipped ${sourceName}.`);
        planItems.push({
          kind: "skip",
          label: `mcp: ${name}`,
          reason: `Already found in another Claude MCP source; skipped ${sourceName}.`
        });
        continue;
      }
      servers[name] = server;
    }
  }

  return { servers, manualReviews, planItems };
}

function extractCodexMcp(cwd) {
  return analyzeCodexMcp(cwd).servers;
}

function analyzeCodexMcp(cwd) {
  return analyzeCodexMcpFromToml(readText(projectPaths(cwd).codexConfig));
}

function analyzeCodexMcpFromToml(toml) {
  if (!toml) return { servers: {}, manualReviews: [], planItems: [] };
  const servers = {};
  const manualReviews = [];
  const planItems = [];

  // Group TOML tables by MCP server, merging a nested [mcp_servers.<name>.env]
  // sub-table into its parent. Splitting on every table header (not just the
  // next mcp_servers one) keeps unrelated tables like [profiles.default] from
  // leaking their keys into an MCP server's field list.
  const order = [];
  const raw = new Map();
  for (const section of toml.split(/\n(?=\[)/g)) {
    const header = section.match(/^\[([^\]\n]*)\]/);
    if (!header) continue;
    const segs = parseTomlHeaderPath(header[1]);
    if (segs[0] !== "mcp_servers" || segs.length < 2) continue;
    const name = segs[1];
    if (!raw.has(name)) { raw.set(name, { command: undefined, args: undefined, env: undefined, url: undefined, hasAuth: false, unsupported: [] }); order.push(name); }
    const entry = raw.get(name);
    const body = section.slice(header[0].length);
    if (segs.length === 2) {
      entry.command = parseTomlValue(extractTomlRawValue(section, "command"));
      entry.args = parseTomlValue(extractTomlRawValue(section, "args"));
      entry.url = parseTomlValue(extractTomlRawValue(section, "url"));
      const inlineEnv = parseTomlValue(extractTomlRawValue(section, "env"));
      if (inlineEnv) entry.env = { ...(entry.env ?? {}), ...inlineEnv };
      const handled = ["command", "args", "env", "url", "bearer_token_env_var", "http_headers", "env_http_headers"];
      for (const field of [...body.matchAll(/^([A-Za-z0-9_-]+)[ \t]*=/gm)].map((match) => match[1])) {
        if (["bearer_token_env_var", "http_headers", "env_http_headers"].includes(field)) entry.hasAuth = true;
        if (!handled.includes(field) && !entry.unsupported.includes(field)) entry.unsupported.push(field);
      }
    } else if (segs.length === 3 && segs[2] === "env") {
      entry.env = { ...(entry.env ?? {}), ...parseTomlKeyValueBlock(body) };
    } else if (!entry.unsupported.includes(segs.slice(2).join("."))) {
      entry.unsupported.push(segs.slice(2).join("."));
    }
  }

  for (const name of order) {
    const entry = raw.get(name);
    const flagUnsupported = () => {
      if (entry.unsupported.length === 0) return;
      manualReviews.push(`Codex MCP server "${name}" has unsupported fields not migrated: ${entry.unsupported.join(", ")}.`);
      planItems.push({ kind: "manual-review", label: `mcp: ${name}`, reason: `Unsupported fields not migrated: ${entry.unsupported.join(", ")}.` });
    };
    if (entry.command) {
      const server = { command: entry.command, args: entry.args, env: entry.env };
      flagUnsupported();
      addAbsolutePathReviews({ name, server, manualReviews, planItems });
      servers[name] = server;
      continue;
    }
    if (typeof entry.url === "string") {
      if (entry.hasAuth) {
        manualReviews.push(`Codex MCP server "${name}" is an HTTP server; its URL was migrated, but auth (bearer_token_env_var / http_headers) needs manual setup in Claude.`);
        planItems.push({ kind: "manual-review", label: `mcp: ${name}`, reason: "HTTP server URL migrated; auth needs manual setup." });
      }
      flagUnsupported();
      servers[name] = { url: entry.url };
      continue;
    }
    manualReviews.push(`Codex MCP server "${name}" was not converted because it has no stdio command or url.`);
    planItems.push({ kind: "manual-review", label: `mcp: ${name}`, reason: "Codex MCP section has no stdio command or url." });
  }
  return { servers, manualReviews, planItems };
}

// --- Minimal dependency-free reader for the TOML value forms used by MCP
// configs: quoted strings, arrays of strings, and inline tables. Unlike a
// single-line regex, this handles multi-line `args`/`env` and quoted values
// that contain commas or "=".
function extractTomlRawValue(section, key) {
  const match = section.match(new RegExp(`^${key}[ \\t]*=[ \\t]*`, "m"));
  if (!match) return undefined;
  return readTomlValueSpan(section, match.index + match[0].length);
}

function readTomlValueSpan(text, start) {
  while (start < text.length && (text[start] === " " || text[start] === "\t")) start += 1;
  const open = text[start];
  if (open === "\"" || open === "'") return text.slice(start, scanTomlString(text, start));
  if (open === "[" || open === "{") {
    const close = open === "[" ? "]" : "}";
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "\"" || ch === "'") { i = scanTomlString(text, i) - 1; continue; }
      if (ch === "#") { const nl = text.indexOf("\n", i); if (nl === -1) return text.slice(start); i = nl; continue; }
      if (ch === open) depth += 1;
      else if (ch === close && (depth -= 1) === 0) return text.slice(start, i + 1);
    }
    return text.slice(start);
  }
  const nl = text.indexOf("\n", start);
  const raw = nl === -1 ? text.slice(start) : text.slice(start, nl);
  const comment = raw.indexOf("#");
  return (comment === -1 ? raw : raw.slice(0, comment)).trim();
}

// Index just past the closing quote of the string starting at `start`.
function scanTomlString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (quote === "\"" && text[i] === "\\") { i += 1; continue; }
    if (text[i] === quote) return i + 1;
  }
  return text.length;
}

function parseTomlValue(raw) {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (text === "") return undefined;
  if (text[0] === "[") return splitTomlList(text.slice(1, -1)).map(parseTomlValue);
  if (text[0] === "{") return parseTomlInlineTable(text.slice(1, -1));
  return parseTomlScalar(text);
}

function parseTomlInlineTable(body) {
  const out = {};
  for (const pair of splitTomlList(body)) {
    const eq = topLevelEqualsIndex(pair);
    if (eq === -1) continue;
    out[unquoteTomlKey(pair.slice(0, eq).trim())] = parseTomlValue(pair.slice(eq + 1).trim());
  }
  return out;
}

function parseTomlScalar(text) {
  if (text[0] === "\"") {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  if (text[0] === "'") return text.slice(1, text.endsWith("'") ? -1 : text.length);
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

// Split a comma-separated TOML body at top level, respecting strings and
// nested []/{}. Trailing commas and empty entries are dropped.
function splitTomlList(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\"" || ch === "'") {
      const end = scanTomlString(body, i);
      current += body.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === "#") { const nl = body.indexOf("\n", i); if (nl === -1) break; i = nl; continue; }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function topLevelEqualsIndex(pair) {
  let depth = 0;
  for (let i = 0; i < pair.length; i += 1) {
    const ch = pair[i];
    if (ch === "\"" || ch === "'") { i = scanTomlString(pair, i) - 1; continue; }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    else if (ch === "=" && depth === 0) return i;
  }
  return -1;
}

function unquoteTomlKey(key) {
  if ((key[0] === "\"" && key.endsWith("\"")) || (key[0] === "'" && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

// Split a dotted table header (the text between [ and ]) into key segments,
// honoring quoted segments. `mcp_servers.node_repl.env` -> [mcp_servers, node_repl, env];
// `mcp_servers."a.b"` -> [mcp_servers, "a.b"].
function parseTomlHeaderPath(inner) {
  const segs = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && (inner[i] === " " || inner[i] === "\t" || inner[i] === ".")) i += 1;
    if (i >= inner.length) break;
    if (inner[i] === "\"" || inner[i] === "'") {
      const end = scanTomlString(inner, i);
      segs.push(parseTomlScalar(inner.slice(i, end)));
      i = end;
    } else {
      let j = i;
      while (j < inner.length && inner[j] !== "." && inner[j] !== " " && inner[j] !== "\t") j += 1;
      segs.push(inner.slice(i, j));
      i = j;
    }
  }
  return segs;
}

// Parse a block of `key = value` lines (the body of an [mcp_servers.x.env]
// sub-table) into an object.
function parseTomlKeyValueBlock(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line[0] === "#" || line[0] === "[") continue;
    const eq = topLevelEqualsIndex(line);
    if (eq === -1) continue;
    out[unquoteTomlKey(line.slice(0, eq).trim())] = parseTomlValue(readTomlValueSpan(line, eq + 1));
  }
  return out;
}

function toCodexToml(servers) {
  return Object.entries(servers).map(([name, server]) => {
    const lines = [`[mcp_servers."${escapeToml(name)}"]`];
    if (server.url) {
      lines.push(`url = "${escapeToml(server.url)}"`);
    } else {
      if (server.command) lines.push(`command = "${escapeToml(server.command)}"`);
      if (Array.isArray(server.args)) lines.push(`args = ${JSON.stringify(server.args)}`);
      if (server.env && Object.keys(server.env).length > 0) {
        const env = Object.entries(server.env)
          .map(([key, value]) => `"${escapeToml(key)}" = "${escapeToml(String(value))}"`)
          .join(", ");
        lines.push(`env = { ${env} }`);
      }
    }
    return `${lines.join("\n")}\n`;
  }).join("\n");
}

// Shape a normalized server map into Claude's .mcp.json / settings.json form:
// HTTP servers become { type: "http", url }, stdio servers keep command/args/env
// with literal env values rewritten to $NAME references.
function toClaudeMcpServers(servers) {
  return Object.fromEntries(Object.entries(servers).map(([name, def]) => {
    if (def?.url) return [name, { type: "http", url: def.url }];
    const out = {};
    if (def?.command !== undefined) out.command = def.command;
    if (def?.args !== undefined) out.args = def.args;
    if (def?.env) out.env = referenceEnv(def.env);
    return [name, out];
  }));
}

function analyzeClaudeMcp(servers, existingCodexNames = new Set()) {
  const supported = {};
  const manualReviews = [];
  const planItems = [];
  for (const [name, server] of Object.entries(servers)) {
    if (existingCodexNames.has(name)) {
      manualReviews.push(`Claude MCP server "${name}" was skipped because Codex config already has a server with that name.`);
      planItems.push({
        kind: "skip",
        label: `mcp: ${name}`,
        reason: "Codex config already has a server with that name."
      });
      continue;
    }
    if (server?.command) {
      const unsupportedFields = Object.keys(server).filter((field) => !["command", "args", "env"].includes(field));
      if (unsupportedFields.length > 0) {
        manualReviews.push(`Claude MCP server "${name}" has unsupported fields not migrated: ${unsupportedFields.join(", ")}.`);
        planItems.push({
          kind: "manual-review",
          label: `mcp: ${name}`,
          reason: `Unsupported fields not migrated: ${unsupportedFields.join(", ")}.`
        });
      }
      addAbsolutePathReviews({ name, server, manualReviews, planItems });
      supported[name] = { command: server.command, args: server.args, env: server.env };
      continue;
    }
    if (typeof server?.url === "string") {
      const hasAuth = server.headers || Object.keys(server).some((field) => !["type", "url"].includes(field));
      if (hasAuth) {
        manualReviews.push(`Claude MCP server "${name}" is an HTTP server; its URL was migrated, but auth headers need manual setup in Codex (bearer_token_env_var / http_headers).`);
        planItems.push({
          kind: "manual-review",
          label: `mcp: ${name}`,
          reason: "HTTP server URL migrated; auth headers need manual setup."
        });
      }
      supported[name] = { url: server.url };
      continue;
    }
    const fields = server && typeof server === "object" ? Object.keys(server).join(", ") : "non-object value";
    manualReviews.push(`Claude MCP server "${name}" needs manual migration; only stdio (command/args/env) or HTTP (url) servers are converted automatically. Found fields: ${fields}.`);
    planItems.push({
      kind: "manual-review",
      label: `mcp: ${name}`,
      reason: `Only stdio (command) or HTTP (url) servers are converted automatically. Found fields: ${fields}.`
    });
  }
  return { supported, manualReviews, planItems };
}

function addAbsolutePathReviews({ name, server, manualReviews, planItems }) {
  const paths = findAbsolutePathsInMcpServer(server);
  if (paths.length === 0) return;
  const uniquePaths = [...new Set(paths)];
  const rendered = uniquePaths.join(", ");
  manualReviews.push(`MCP server "${name}" contains local absolute path values that may not work on another machine: ${rendered}.`);
  planItems.push({
    kind: "manual-review",
    label: `mcp: ${name}`,
    reason: `Contains local absolute path values: ${rendered}.`
  });
}

function findAbsolutePathsInMcpServer(server) {
  const values = [
    server?.command,
    ...(Array.isArray(server?.args) ? server.args : []),
    ...Object.values(server?.env ?? {})
  ];
  return values
    .filter((value) => typeof value === "string")
    .filter((value) => looksLikeLocalAbsolutePath(value));
}

function looksLikeLocalAbsolutePath(value) {
  if (/^[a-zA-Z]+:\/\//.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return value.startsWith("/") && !value.startsWith("//");
}

function escapeToml(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

async function makeBackup(cwd, changes = []) {
  const files = projectPaths(cwd);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(files.backupDir, stamp);
  await mkdir(backupDir, { recursive: true });
  const backedUp = [];
  const planned = fileChanges(changes).map((change) => path.relative(cwd, change.path));
  for (const relative of [RELATIVE_PATHS.claudeMd, RELATIVE_PATHS.agentsMd, RELATIVE_PATHS.mcpJson, RELATIVE_PATHS.claudeDir, RELATIVE_PATHS.codexDir, RELATIVE_PATHS.agentsDir, RELATIVE_PATHS.report]) {
    const source = path.join(cwd, relative);
    if (!existsSync(source)) continue;
    const target = path.join(backupDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (statSync(source).isDirectory()) await copyTree(source, target);
    else await copyFile(source, target);
    backedUp.push(relative);
  }
  const created = {};
  for (const change of changes) {
    if (!change.path || existsSync(change.path)) continue;
    const relative = path.relative(cwd, change.path);
    const expectedHash = expectedHashForChange(change);
    if (expectedHash) created[relative] = expectedHash;
  }
  await writeFile(path.join(backupDir, ".ai-switch-manifest.json"), `${JSON.stringify({ createdAt: stamp, backedUp, planned, created }, null, 2)}\n`);
  return backupDir;
}

function expectedHashForChange(change) {
  if (change.kind === "write") return hashText(change.content);
  if (change.kind === "copy-dir") return hashPath(change.from);
  return undefined;
}

// After changes are applied, recompute every migration-created hash from the
// actual files on disk. The pre-apply estimate is wrong when several changes
// merge into one target (e.g. .codex/skills + .agents/skills -> .claude/skills),
// which would otherwise make `restore` think its own output was user-edited.
async function refreshCreatedHashes(backupDir, resolve) {
  const manifestPath = path.join(backupDir, ".ai-switch-manifest.json");
  const manifest = readJson(manifestPath);
  if (!manifest || manifest.__parseError || !manifest.created) return;
  for (const key of Object.keys(manifest.created)) {
    const target = resolve(key);
    if (existsSync(target)) manifest.created[key] = hashPath(target);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashPath(target) {
  if (!existsSync(target)) return undefined;
  const stats = lstatSync(target);
  if (stats.isSymbolicLink()) return hashText(`symlink:${readlinkSync(target)}`);
  if (!stats.isDirectory()) {
    if (!stats.isFile()) return undefined;
    return hashText(readFileSync(target));
  }

  const hash = createHash("sha256");
  hash.update("dir\n");
  for (const name of readdirSync(target).sort()) {
    const child = path.join(target, name);
    const childHash = hashPath(child);
    if (childHash === undefined) continue;
    hash.update(`${name}\0${childHash}\n`);
  }
  return hash.digest("hex");
}

async function copyTree(from, to) {
  await cp(from, to, {
    recursive: true,
    filter: (source) => isCopyablePath(source)
  });
}

function isCopyablePath(source) {
  try {
    const stats = lstatSync(source);
    return stats.isDirectory() || stats.isFile() || stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function listBackups(cwd) {
  return listBackupDirs(projectPaths(cwd).backupDir);
}

function listGlobalBackups(home = homedir()) {
  return listBackupDirs(globalPathsFor(home).backupDir);
}

function listBackupDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(path.join(dir, name, ".ai-switch-manifest.json")))
    .sort();
}

async function restoreBackup(cwd, selector, options = {}) {
  const backups = listBackups(cwd);
  if (backups.length === 0) throw new Error("No ai-switch backups found.");
  const stamp = selector === "latest" ? backups.at(-1) : selector;
  if (!backups.includes(stamp)) throw new Error(`Backup not found: ${selector}`);

  const backupDir = path.join(projectPaths(cwd).backupDir, stamp);
  const manifest = readJson(path.join(backupDir, ".ai-switch-manifest.json"));
  if (!manifest || manifest.__parseError) throw new Error(`Invalid backup manifest: ${stamp}`);

  const removals = (manifest.planned ?? []).filter((relative) => !(manifest.backedUp ?? []).includes(relative));
  for (const relative of removals) {
    assertGeneratedPathUnchanged(cwd, relative, manifest, options.force);
  }

  for (const relative of removals) {
    const target = path.join(cwd, relative);
    if (existsSync(target)) await rm(target, { recursive: true, force: true });
  }
  await pruneEmptyParents(cwd, manifest.planned ?? [], manifest.backedUp ?? []);

  for (const relative of manifest.backedUp ?? []) {
    const source = path.join(backupDir, relative);
    const target = path.join(cwd, relative);
    if (!existsSync(source)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    if (statSync(source).isDirectory()) {
      await rm(target, { recursive: true, force: true });
      await copyTree(source, target);
    }
    else await copyFile(source, target);
  }

  return backupDir;
}

function assertGeneratedPathUnchanged(cwd, relative, manifest, force = false) {
  const target = path.join(cwd, relative);
  if (!existsSync(target)) return;
  const expectedHash = manifest.created?.[relative];
  if (!expectedHash) {
    if (!force) throw new Error(`Refusing to remove ${relative}; backup has no hash metadata. Re-run restore with --force to remove it.`);
    return;
  }
  const actualHash = hashPath(target);
  if (actualHash !== expectedHash && !force) {
    throw new Error(`Refusing to remove changed migration-created path without --force: ${relative}`);
  }
}

async function pruneEmptyParents(cwd, planned, backedUp) {
  const backedUpSet = new Set(backedUp);
  for (const relative of planned) {
    if (backedUpSet.has(relative)) continue;
    let dir = path.dirname(path.join(cwd, relative));
    while (dir !== cwd && dir.startsWith(cwd)) {
      const rel = path.relative(cwd, dir);
      if (!rel || rel === RELATIVE_PATHS.backupDir || rel.startsWith(`${RELATIVE_PATHS.backupDir}${path.sep}`)) break;
      try {
        await rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }
}

async function convert(fromRaw, toRaw, options) {
  const from = normalizeProvider(fromRaw);
  const to = normalizeProvider(toRaw);
  if (from === to) throw new Error("Source and target providers are the same.");

  const changes = from === "cc"
    ? planCcToCodex(options.cwd)
    : planCodexToCc(options.cwd);

  if (options.dryRun) {
    printPlan(changes, options.cwd);
    return { backupDir: null, changes };
  }

  // Read-only previews (status, dry-run) are allowed anywhere; only block writes.
  assertProjectWriteScope(options.cwd);

  if (!options.yes) {
    throw new Error("Refusing to write without --yes. Run with --dry-run first, then add --yes.");
  }

  assertNoUnsafeOverwrites(changes, options.cwd, options.force);

  const backupDir = await makeBackup(options.cwd, changes);
  for (const change of fileChanges(changes)) {
    await mkdir(path.dirname(change.path), { recursive: true });
    if (change.kind === "copy-dir") await copyTree(change.from, change.path);
    else await writeFile(change.path, change.content, "utf8");
  }
  await refreshCreatedHashes(backupDir, (relative) => path.join(options.cwd, relative));
  return { backupDir, changes };
}

// ---------------------------------------------------------------------------
// Global (home-level) convert. Operates ONLY on the allowlisted files in
// ~/.claude and ~/.codex (never whole directories). Same secret policy as
// project convert: literal env values become $NAME references. Backups live in
// ~/.ai-switch/backups/global with a "global" manifest scope.
// ---------------------------------------------------------------------------

function globalClaudeMcp(files) {
  const settings = readJson(files.claudeSettings);
  if (!settings || settings.__parseError) return {};
  return settings.mcpServers && typeof settings.mcpServers === "object" ? settings.mcpServers : {};
}

function planCcToCodexGlobal(home, env = process.env) {
  const files = globalPathsFor(home, env);
  const changes = [];
  const manualReviews = [];
  let credentials = [];

  const claudeMd = readText(files.claudeMd);
  if (claudeMd) changes.push({ kind: "write", path: files.agentsMd, content: migrateInstruction(claudeMd, "CLAUDE.md") });

  const mcp = globalClaudeMcp(files);
  if (Object.keys(mcp).length > 0) {
    const current = readText(files.codexConfig) ?? "";
    const analysis = analyzeClaudeMcp(mcp, codexMcpNames(current));
    manualReviews.push(...analysis.manualReviews);
    changes.push(...analysis.planItems);
    if (Object.keys(analysis.supported).length > 0) {
      credentials = collectCredentials(analysis.supported);
      const migratedBlock = `\n# Migrated from Claude MCP settings by ai-switch.\n${toCodexToml(withReferencedEnv(analysis.supported))}`;
      changes.push({ kind: "write", path: files.codexConfig, content: mergeCodexConfig(current, migratedBlock) });
    }
  }

  if (existsSync(files.claudeSkills)) changes.push({ kind: "copy-dir", from: files.claudeSkills, path: files.agentsSkills });

  changes.push(reportChange(home, files.report, "cc", "codex", changes, manualReviews, credentials));
  return changes;
}

function planCodexToCcGlobal(home, env = process.env) {
  const files = globalPathsFor(home, env);
  const changes = [];
  const manualReviews = [];

  const agentsMd = readText(files.agentsMd);
  if (agentsMd) changes.push({ kind: "write", path: files.claudeMd, content: migrateInstruction(agentsMd, "AGENTS.md") });

  const mcpAnalysis = analyzeCodexMcpFromToml(readText(files.codexConfig));
  manualReviews.push(...mcpAnalysis.manualReviews);
  changes.push(...mcpAnalysis.planItems);
  const credentials = collectCredentials(mcpAnalysis.servers);
  const incoming = mcpAnalysis.servers;

  if (Object.keys(incoming).length > 0) {
    const existing = readJson(files.claudeSettings);
    if (existing?.__parseError) {
      manualReviews.push(`~/.claude/settings.json could not be parsed (${existing.__parseError}); MCP servers were not merged to avoid overwriting it.`);
    } else {
      const base = existing && typeof existing === "object" ? existing : {};
      const existingMcp = base.mcpServers && typeof base.mcpServers === "object" ? base.mcpServers : {};
      const mergedMcp = { ...existingMcp };
      for (const [name, def] of Object.entries(toClaudeMcpServers(incoming))) {
        if (Object.hasOwn(existingMcp, name)) {
          manualReviews.push(`Claude MCP server "${name}" was skipped because ~/.claude/settings.json already has a server with that name.`);
          changes.push({ kind: "skip", label: `mcp: ${name}`, reason: "Claude global settings already has a server with that name." });
          continue;
        }
        mergedMcp[name] = def;
      }
      if (JSON.stringify(mergedMcp) !== JSON.stringify(existingMcp)) {
        changes.push({ kind: "write", path: files.claudeSettings, content: `${JSON.stringify({ ...base, mcpServers: mergedMcp }, null, 2)}\n` });
      }
    }
  }

  changes.push(...skillCopyChanges(codexSkillSources(files), files.claudeSkills));

  changes.push(reportChange(home, files.report, "codex", "cc", changes, manualReviews, credentials));
  return changes;
}

async function convertGlobal(fromRaw, toRaw, options) {
  const from = normalizeProvider(fromRaw);
  const to = normalizeProvider(toRaw);
  if (from === to) throw new Error("Source and target providers are the same.");
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const files = globalPathsFor(home, env);

  const changes = from === "cc" ? planCcToCodexGlobal(home, env) : planCodexToCcGlobal(home, env);

  if (options.dryRun) {
    printPlan(changes, home);
    return { backupDir: null, changes };
  }
  if (!options.yes) {
    throw new Error("Refusing to write without --yes. Run with --dry-run first, then add --yes.");
  }
  assertNoUnsafeOverwritesGlobal(changes, files, options.force);

  const backupDir = await makeGlobalBackup(home, env, changes);
  for (const change of fileChanges(changes)) {
    await mkdir(path.dirname(change.path), { recursive: true });
    if (change.kind === "copy-dir") await copyTree(change.from, change.path);
    else await writeFile(change.path, change.content, "utf8");
  }
  // Global manifest keys created paths by absolute path.
  await refreshCreatedHashes(backupDir, (key) => key);
  return { backupDir, changes };
}

function assertNoUnsafeOverwritesGlobal(changes, files, force = false) {
  const exempt = new Set([files.report, files.codexConfig, files.claudeSettings]);
  const unsafe = fileChanges(changes)
    .filter((change) => existsSync(change.path) && !exempt.has(change.path))
    .map((change) => change.path);
  if (unsafe.length > 0 && !force) {
    throw new Error(`Refusing to overwrite existing global files without --force: ${unsafe.join(", ")}`);
  }
}

async function makeGlobalBackup(home, env, changes) {
  const files = globalPathsFor(home, env);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(files.backupDir, stamp);
  await mkdir(backupDir, { recursive: true });
  const backedUp = [];
  for (const item of globalAllowlist(files)) {
    if (!existsSync(item.path)) continue;
    const target = path.join(backupDir, item.key);
    await mkdir(path.dirname(target), { recursive: true });
    if (statSync(item.path).isDirectory()) await copyTree(item.path, target);
    else await copyFile(item.path, target);
    backedUp.push({ key: item.key, target: item.path });
  }
  const planned = fileChanges(changes).map((change) => change.path);
  const created = {};
  for (const change of changes) {
    if (!change.path || existsSync(change.path)) continue;
    const hash = expectedHashForChange(change);
    if (hash) created[change.path] = hash;
  }
  await writeFile(path.join(backupDir, ".ai-switch-manifest.json"),
    `${JSON.stringify({ scope: "global", createdAt: stamp, backedUp, planned, created }, null, 2)}\n`);
  return backupDir;
}

async function restoreGlobalBackup(home, selector, env = process.env, options = {}) {
  const files = globalPathsFor(home, env);
  const backups = listBackupDirs(files.backupDir);
  if (backups.length === 0) throw new Error("No ai-switch global backups found.");
  const stamp = selector === "latest" ? backups.at(-1) : selector;
  if (!backups.includes(stamp)) throw new Error(`Global backup not found: ${selector}`);

  const backupDir = path.join(files.backupDir, stamp);
  const manifest = readJson(path.join(backupDir, ".ai-switch-manifest.json"));
  if (!manifest || manifest.__parseError) throw new Error(`Invalid backup manifest: ${stamp}`);

  const backedUpTargets = new Set((manifest.backedUp ?? []).map((entry) => entry.target));
  const removals = (manifest.planned ?? []).filter((target) => !backedUpTargets.has(target));
  for (const target of removals) assertGeneratedAbsUnchanged(target, manifest, options.force);
  for (const target of removals) {
    if (existsSync(target)) await rm(target, { recursive: true, force: true });
  }
  await pruneEmptyParentsAbs(removals, home);
  for (const entry of manifest.backedUp ?? []) {
    const source = path.join(backupDir, entry.key);
    if (!existsSync(source)) continue;
    await mkdir(path.dirname(entry.target), { recursive: true });
    if (statSync(source).isDirectory()) {
      await rm(entry.target, { recursive: true, force: true });
      await copyTree(source, entry.target);
    } else await copyFile(source, entry.target);
  }
  return backupDir;
}

// Remove now-empty directories left behind after deleting migration-created
// files (e.g. a fresh ~/.codex). rmdir fails on non-empty dirs, so anything
// still holding auth/sessions/other files is preserved. Stops at `home`.
async function pruneEmptyParentsAbs(paths, stopDir) {
  for (const target of paths) {
    let dir = path.dirname(target);
    while (dir.startsWith(stopDir) && dir !== stopDir && dir !== path.dirname(dir)) {
      try {
        await rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }
}

function assertGeneratedAbsUnchanged(target, manifest, force = false) {
  if (!existsSync(target)) return;
  const expectedHash = manifest.created?.[target];
  if (!expectedHash) {
    if (!force) throw new Error(`Refusing to remove ${target}; backup has no hash metadata. Re-run restore with --force to remove it.`);
    return;
  }
  if (hashPath(target) !== expectedHash && !force) {
    throw new Error(`Refusing to remove changed migration-created path without --force: ${target}`);
  }
}

function assertProjectWriteScope(cwd) {
  if (!isHomeDirectory(cwd)) return;
  throw new Error("Refusing project migration in your home directory. Run convert/backup/restore inside a project directory, or use `--global` for home-level config (e.g. `ai-switch convert cc codex --global`).");
}

function isHomeDirectory(cwd, home = homedir()) {
  return realPathOrResolve(cwd) === realPathOrResolve(home);
}

function realPathOrResolve(target) {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function planCcToCodex(cwd) {
  const files = projectPaths(cwd);
  const changes = [];
  const manualReviews = [];
  const claudeMd = readText(files.claudeMd);
  if (claudeMd) {
    changes.push({
      kind: "write",
      path: files.agentsMd,
      content: migrateInstruction(claudeMd, "CLAUDE.md")
    });
  }

  const sourceAnalysis = analyzeClaudeMcpSources(cwd);
  const mcp = sourceAnalysis.servers;
  manualReviews.push(...sourceAnalysis.manualReviews);
  changes.push(...sourceAnalysis.planItems);
  let credentials = [];
  if (Object.keys(mcp).length > 0) {
    const current = readText(files.codexConfig) ?? "";
    const analysis = analyzeClaudeMcp(mcp, codexMcpNames(current));
    manualReviews.push(...analysis.manualReviews);
    changes.push(...analysis.planItems);
    if (Object.keys(analysis.supported).length > 0) {
      credentials = collectCredentials(analysis.supported);
      const migratedBlock = `\n# Migrated from Claude MCP settings by ai-switch.\n${toCodexToml(withReferencedEnv(analysis.supported))}`;
      changes.push({
        kind: "write",
        path: files.codexConfig,
        content: mergeCodexConfig(current, migratedBlock)
      });
    }
  }

  if (existsSync(files.claudeSkills)) {
    changes.push({ kind: "copy-dir", from: files.claudeSkills, path: files.agentsSkills });
  }

  changes.push(reportChange(cwd, files.report, "cc", "codex", changes, manualReviews, credentials));
  return changes;
}

function planCodexToCc(cwd) {
  const files = projectPaths(cwd);
  const changes = [];
  const manualReviews = [];
  const agentsMd = readText(files.agentsMd);
  if (agentsMd) {
    changes.push({
      kind: "write",
      path: files.claudeMd,
      content: migrateInstruction(agentsMd, "AGENTS.md")
    });
  }

  const mcpAnalysis = analyzeCodexMcp(cwd);
  const mcp = mcpAnalysis.servers;
  manualReviews.push(...mcpAnalysis.manualReviews);
  changes.push(...mcpAnalysis.planItems);
  const credentials = collectCredentials(mcp);
  if (Object.keys(mcp).length > 0) {
    changes.push({
      kind: "write",
      path: files.mcpJson,
      content: `${JSON.stringify({ mcpServers: toClaudeMcpServers(mcp) }, null, 2)}\n`
    });
  }

  changes.push(...skillCopyChanges(codexSkillSources(files), files.claudeSkills));

  changes.push(reportChange(cwd, files.report, "codex", "cc", changes, manualReviews, credentials));
  return changes;
}

function migrateInstruction(content, sourceName) {
  let body = content.trim();
  while (MIGRATION_HEADER.test(body)) {
    body = body.replace(MIGRATION_HEADER, "").trim();
  }
  return `# Project Instructions\n\nMigrated from ${sourceName} by ai-switch.\n\n${body}\n`;
}

function mergeCodexConfig(current, migratedBlock) {
  if (!current.trim()) return migratedBlock.trimStart();
  return `${current.trimEnd()}\n${migratedBlock}`;
}

function reportChange(baseDir, reportPath, from, to, changes, manualReviews = [], credentials = []) {
  const lines = [
    `# ai-switch migration report`,
    "",
    `- from: ${from}`,
    `- to: ${to}`,
    `- generated: ${new Date().toISOString()}`,
    "",
    "## Planned changes",
    "",
    ...fileChanges(changes).map((change) => `- ${change.kind}: ${path.relative(baseDir, change.path)}`),
    "",
    "## Manual review needed",
    "",
    ...(manualReviews.length > 0 ? manualReviews.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Environment variables needed",
    "",
    "ai-switch never copies literal env values into target configs or reports. Set these variables in the target tool's environment before the migrated MCP servers will run:",
    "",
    ...credentialLines(credentials),
    "",
    "## Notes",
    "",
    "- Secrets and account sessions are intentionally not migrated.",
    "- Literal env values are replaced with `$NAME` in the migrated config and this report; they are never written into the target tool. Verify paths before use.",
    "- Backups preserve your original allowlisted files (project: `.ai-switch-backups/`, global: `~/.ai-switch/backups/global/`, both gitignored). If those files contain literal secrets, the backup will too.",
    "- Skills are copied as files, but runtime compatibility depends on each agent."
  ];
  return {
    kind: "write",
    path: reportPath,
    content: `${lines.join("\n")}\n`,
    report: true,
    manualReviews,
    credentials
  };
}

// Inventory the env vars the migrated MCP servers depend on, without ever
// emitting secret values. References like `$TOKEN` are safe to show; literal
// values are flagged (redacted) so the user knows a real secret is sitting in
// config and should be moved to the environment.
function collectCredentials(serversMap) {
  const credentials = [];
  for (const [server, def] of Object.entries(serversMap)) {
    if (!def?.env || typeof def.env !== "object") continue;
    for (const [name, value] of Object.entries(def.env)) {
      credentials.push({ server, name, isReference: isEnvReference(value) });
    }
  }
  return credentials;
}

function isEnvReference(value) {
  return typeof value === "string" && /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value.trim());
}

// Scan the config files that a migration would back up (not just the servers it
// converts) for literal env values, so the CLI warning covers secrets already
// sitting in the existing target config too.
function literalEnvNamesInConfigs(configs) {
  const names = new Set();
  for (const config of configs) {
    if (!existsSync(config.path)) continue;
    let servers = {};
    if (config.format === "json") {
      const data = readJson(config.path);
      if (data && !data.__parseError && data.mcpServers && typeof data.mcpServers === "object") servers = data.mcpServers;
    } else {
      servers = analyzeCodexMcpFromToml(readText(config.path)).servers;
    }
    for (const def of Object.values(servers)) {
      for (const [name, value] of Object.entries(def?.env ?? {})) {
        if (!isEnvReference(value)) names.add(name);
      }
    }
  }
  return [...names];
}

function projectConfigScanList(cwd) {
  const files = projectPaths(cwd);
  return [
    { path: files.mcpJson, format: "json" },
    { path: files.claudeSettings, format: "json" },
    { path: files.codexConfig, format: "toml" }
  ];
}

function globalConfigScanList(home, env = process.env) {
  const files = globalPathsFor(home, env);
  return [
    { path: files.claudeSettings, format: "json" },
    { path: files.codexConfig, format: "toml" }
  ];
}

// Never write a secret value into the target config. `$VAR` references pass
// through unchanged; any literal value is replaced with a `$NAME` reference so
// the wiring survives but the secret does not travel between tools.
function referenceEnv(env) {
  if (!env || typeof env !== "object") return env;
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = isEnvReference(value) ? value : `$${key}`;
  }
  return out;
}

function withReferencedEnv(servers) {
  return Object.fromEntries(Object.entries(servers).map(([name, def]) =>
    [name, def?.env ? { ...def, env: referenceEnv(def.env) } : def]));
}

function credentialLines(credentials) {
  if (credentials.length === 0) return ["- None"];
  return credentials.map((cred) => cred.isReference
    ? `- ${cred.name} (server: ${cred.server}) — referenced via env; set the same variable for the target tool`
    : `- ${cred.name} (server: ${cred.server}) — source config had a literal value; written as \`$${cred.name}\` reference instead (the value was not copied). Set it in the environment, and rotate it if it was a secret`);
}

function assertNoUnsafeOverwrites(changes, cwd, force = false) {
  const unsafe = fileChanges(changes)
    .filter((change) => isUnsafeOverwrite(change, cwd))
    .map((change) => path.relative(cwd, change.path));
  if (unsafe.length > 0 && !force) {
    throw new Error(`Refusing to overwrite existing files without --force: ${unsafe.join(", ")}`);
  }
}

function isUnsafeOverwrite(change, cwd) {
  if (!existsSync(change.path)) return false;
  const relative = path.relative(cwd, change.path);
  if (relative === RELATIVE_PATHS.report) return false;
  if (relative === RELATIVE_PATHS.codexConfig) return false;
  return true;
}

function planLabel(change, cwd) {
  if (change.kind === "skip" || change.kind === "manual-review") {
    return { action: change.kind, label: change.label, reason: change.reason };
  }
  const relative = path.relative(cwd, change.path);
  if (change.report || relative === RELATIVE_PATHS.report) return { action: "report", label: relative };
  if (change.kind === "copy-dir") {
    return {
      action: existsSync(change.path) ? "merge" : "copy",
      label: `${path.relative(cwd, change.from)} -> ${relative}`
    };
  }
  if (!existsSync(change.path)) return { action: "create", label: relative };
  if (relative === RELATIVE_PATHS.codexConfig || relative === RELATIVE_PATHS.claudeSettings) return { action: "update", label: relative };
  return { action: "overwrite", label: relative };
}

function printPlan(changes, cwd) {
  for (const change of changes) {
    const item = planLabel(change, cwd);
    console.log(`${item.action.padEnd(13)} ${item.label}${item.reason ? ` (${item.reason})` : ""}`);
  }
}

function fileChanges(changes) {
  return changes.filter((change) => change.path);
}

function printDetection(result) {
  console.log(JSON.stringify(result, null, 2));
}

function status(cwd, options = {}) {
  return options.global ? globalStatus(options.home ?? homedir(), options.env ?? process.env) : projectStatus(cwd);
}

function projectStatus(cwd) {
  const result = detect(cwd);
  const backups = listBackups(cwd).length;
  const notes = isHomeDirectory(cwd)
    ? ["Note: this is your home directory. For home-level config use `--global` (e.g. `ai-switch convert cc codex --global`); run project conversions inside a project directory."]
    : [];
  return [
    `Project: ${result.cwd}`,
    formatProviderStatus("Claude Code", result.claude, cwd, RELATIVE_PATHS.claudeMd),
    formatProviderStatus("Codex", result.codex, cwd, RELATIVE_PATHS.agentsMd),
    `Backups: ${backups}`,
    ...notes,
    ...(result.parseErrors.length > 0 ? ["Parse errors:", ...result.parseErrors.map((item) => `- ${item}`)] : [])
  ].join("\n");
}

function globalStatus(home = homedir(), env = process.env) {
  const result = detectGlobal(home, env);
  const backups = listGlobalBackups(home).length;
  return [
    `Global: ${result.home}`,
    formatGlobalProviderStatus("Claude Code", result.claude, home, RELATIVE_PATHS.claudeMd),
    formatGlobalProviderStatus("Codex", result.codex, home, RELATIVE_PATHS.agentsMd),
    `Backups: ${backups}`,
    ...(result.parseErrors.length > 0 ? ["Parse errors:", ...result.parseErrors.map((item) => `- ${item}`)] : [])
  ].join("\n");
}

function formatProviderStatus(label, provider, cwd, expectedInstructionFile) {
  const instruction = provider.instructionFile ? path.basename(provider.instructionFile) : `no ${expectedInstructionFile}`;
  const config = provider.settingsFile ?? provider.configFile ?? provider.mcpFile;
  const mcp = config ? `${plural(provider.mcpServerCount, "MCP server")} (${path.relative(cwd, config)})` : "no MCP config";
  const skills = provider.skillsDir ? plural(provider.skillCount, "skill") : "no skills";
  return `${label.padEnd(12)} ${instruction}, ${mcp}, ${skills}`;
}

function formatGlobalProviderStatus(label, provider, home, expectedInstructionFile) {
  const instruction = provider.instructionFile ? path.basename(provider.instructionFile) : `no ${expectedInstructionFile}`;
  const config = provider.settingsFile ?? provider.configFile;
  const mcp = config ? `${plural(provider.mcpServerCount, "MCP server")} (${formatDisplayPath(home, config)})` : "no MCP config";
  const skills = provider.skillsDir ? plural(provider.skillCount, "skill") : "no skills";
  return `${label.padEnd(12)} ${instruction}, ${mcp}, ${skills}`;
}

function formatDisplayPath(home, file) {
  const relative = path.relative(home, file);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return `~/${relative}`;
  return file;
}

function plural(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function doctorReport(cwd) {
  const files = projectPaths(cwd);
  const result = detect(cwd);
  const problems = [...result.parseErrors];
  const warnings = [];
  if (!result.claude.instructionFile && !result.codex.instructionFile) {
    problems.push("No CLAUDE.md or AGENTS.md found.");
  }
  if (!result.claude.settingsFile && !result.codex.configFile && !existsSync(files.mcpJson)) {
    warnings.push("No MCP config found.");
  }
  return { result, problems, warnings };
}

function doctor(cwd) {
  const { result, problems, warnings } = doctorReport(cwd);
  printDetection(result);
  if (problems.length > 0) {
    console.log("\nProblems:");
    for (const problem of problems) console.log(`- ${problem}`);
    process.exitCode = 1;
  }
  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    console.log(VERSION);
    return;
  }
  if (args.help || args._.length === 0) {
    console.log(usage());
    return;
  }

  const [command, from, to] = args._;
  validateScopeOptions(command, args);
  if (command === "detect") printDetection(detect(args.cwd));
  else if (command === "status") console.log(status(args.cwd, args));
  else if (command === "doctor") doctor(args.cwd);
  else if (command === "backup") {
    assertProjectWriteScope(args.cwd);
    console.log(await makeBackup(args.cwd));
  }
  else if (command === "backups") {
    const backups = args.global ? listGlobalBackups(args.home ?? homedir()) : listBackups(args.cwd);
    console.log(backups.length > 0 ? backups.join("\n") : "No ai-switch backups found.");
  }
  else if (command === "restore") {
    const selector = from ?? "latest";
    if (args.global) {
      const restored = await restoreGlobalBackup(args.home ?? homedir(), selector, args.env ?? process.env, { force: args.force });
      console.log(`restored from global backup: ${restored}`);
    } else {
      assertProjectWriteScope(args.cwd);
      const restored = await restoreBackup(args.cwd, selector, { force: args.force });
      console.log(`restored from backup: ${restored}`);
    }
  }
  else if (command === "convert") {
    const result = args.global
      ? await convertGlobal(from, to, { ...args, home: args.home ?? homedir() })
      : await convert(from, to, args);
    const literalNames = args.global
      ? literalEnvNamesInConfigs(globalConfigScanList(args.home ?? homedir(), args.env ?? process.env))
      : literalEnvNamesInConfigs(projectConfigScanList(args.cwd));
    if (literalNames.length > 0) {
      console.log(args.dryRun
        ? `warning: your config has literal env values (${literalNames.join(", ")}); a real run (--yes) creates a local backup that will preserve them.`
        : `warning: your config has literal env values (${literalNames.join(", ")}); the local backup preserves them for rollback.`);
    }
    console.log(args.dryRun ? "dry-run complete" : `migrated with backup: ${result.backupDir}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

function validateScopeOptions(command, args) {
  if (args.home && !args.global) throw new Error("--home requires --global.");
  const globalCommands = new Set(["status", "convert", "backups", "restore"]);
  if (args.global && !globalCommands.has(command)) {
    throw new Error(`--global is not supported for "${command}". Use it with status, convert, backups, or restore.`);
  }
}

// Resolve symlinks on both sides: npm installs the bin as a symlink, so a raw
// path comparison would make `process.argv[1]` (the symlink) differ from the
// real module path and skip main() entirely.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export {
  convert,
  detect,
  detectGlobal,
  analyzeClaudeMcp,
  analyzeCodexMcp,
  analyzeClaudeMcpSources,
  doctorReport,
  extractClaudeMcp,
  extractCodexMcp,
  listBackups,
  listGlobalBackups,
  migrateInstruction,
  parseArgs,
  planLabel,
  planCcToCodex,
  planCodexToCc,
  planCcToCodexGlobal,
  planCodexToCcGlobal,
  convertGlobal,
  literalEnvNamesInConfigs,
  restoreBackup,
  restoreGlobalBackup,
  status,
  toCodexToml
};
