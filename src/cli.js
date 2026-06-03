#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { copyFile, cp, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    backupDir: path.join(home, GLOBAL_RELATIVE_PATHS.backupDir)
  };
}

function usage() {
  return `ai-switch

Usage:
  ai-switch detect [--cwd <path>]
  ai-switch status [--cwd <path>]
  ai-switch status --global [--home <path>]
  ai-switch doctor [--cwd <path>]
  ai-switch backup [--cwd <path>]
  ai-switch backups [--cwd <path>]
  ai-switch restore <latest|timestamp> [--cwd <path>] [--force]
  ai-switch convert <cc|codex> <cc|codex> [--cwd <path>] [--dry-run] [--yes] [--force]
  ai-switch --version

Examples:
  ai-switch convert cc codex --dry-run
  ai-switch convert cc codex --yes
  ai-switch convert cc codex --yes --force
  ai-switch convert codex cc --yes
  ai-switch status
  ai-switch status --global
  ai-switch backups
  ai-switch restore latest
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
      skillsDir: existsSync(files.codexSkills) ? files.codexSkills : null,
      skillCount: listDir(files.codexSkills).length,
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
      skillsDir: existsSync(files.codexSkills) ? files.codexSkills : null,
      skillCount: listDir(files.codexSkills).length,
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
  const toml = readText(projectPaths(cwd).codexConfig);
  if (!toml) return { servers: {}, manualReviews: [], planItems: [] };
  const servers = {};
  const manualReviews = [];
  const planItems = [];
  const sections = toml.split(/\n(?=\[mcp_servers\.)/g);
  for (const section of sections) {
    const header = section.match(/^\[mcp_servers\."?([^"\]\n]+)"?\]/m);
    if (!header) continue;
    const name = header[1];
    const command = parseTomlString(section.match(/^command\s*=\s*"([^"]*)"/m)?.[1]);
    const args = parseTomlArray(section.match(/^args\s*=\s*(\[[^\n]*\])/m)?.[1]);
    const env = parseTomlInlineObject(section.match(/^env\s*=\s*(\{[^\n]*\})/m)?.[1]);
    const fieldNames = [...section.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((match) => match[1]);
    const unsupportedFields = fieldNames.filter((field) => !["command", "args", "env"].includes(field));
    if (!command) {
      manualReviews.push(`Codex MCP server "${name}" was not converted because it has no stdio command.`);
      planItems.push({
        kind: "manual-review",
        label: `mcp: ${name}`,
        reason: "Codex MCP section has no stdio command."
      });
      continue;
    }
    if (unsupportedFields.length > 0) {
      manualReviews.push(`Codex MCP server "${name}" has unsupported fields not migrated: ${unsupportedFields.join(", ")}.`);
      planItems.push({
        kind: "manual-review",
        label: `mcp: ${name}`,
        reason: `Unsupported fields not migrated: ${unsupportedFields.join(", ")}.`
      });
    }
    addAbsolutePathReviews({ name, server: { command, args, env }, manualReviews, planItems });
    servers[name] = { command, args, env };
  }
  return { servers, manualReviews, planItems };
}

function parseTomlArray(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(1, -1).split(",").map((part) => part.trim().replace(/^"|"$/g, "")).filter(Boolean);
  }
}

function parseTomlInlineObject(value) {
  if (!value) return undefined;
  const body = value.slice(1, -1).trim();
  if (!body) return {};
  return Object.fromEntries(body.split(",").map((entry) => {
    const [key, raw] = entry.split("=").map((part) => part.trim());
    return [key.replace(/^"|"$/g, ""), parseTomlString(raw.replace(/^"|"$/g, ""))];
  }));
}

function parseTomlString(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function toCodexToml(servers) {
  return Object.entries(servers).map(([name, server]) => {
    const lines = [`[mcp_servers."${escapeToml(name)}"]`];
    if (server.command) lines.push(`command = "${escapeToml(server.command)}"`);
    if (Array.isArray(server.args)) lines.push(`args = ${JSON.stringify(server.args)}`);
    if (server.env && Object.keys(server.env).length > 0) {
      const env = Object.entries(server.env)
        .map(([key, value]) => `"${escapeToml(key)}" = "${escapeToml(String(value))}"`)
        .join(", ");
      lines.push(`env = { ${env} }`);
    }
    return `${lines.join("\n")}\n`;
  }).join("\n");
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
    if (!server?.command) {
      const fields = server && typeof server === "object" ? Object.keys(server).join(", ") : "non-object value";
      manualReviews.push(`Claude MCP server "${name}" needs manual migration; only stdio command/args/env servers are converted automatically. Found fields: ${fields}.`);
      planItems.push({
        kind: "manual-review",
        label: `mcp: ${name}`,
        reason: `Only stdio command/args/env servers are converted automatically. Found fields: ${fields}.`
      });
      continue;
    }
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
    supported[name] = {
      command: server.command,
      args: server.args,
      env: server.env
    };
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
  for (const relative of [RELATIVE_PATHS.claudeMd, RELATIVE_PATHS.agentsMd, RELATIVE_PATHS.mcpJson, RELATIVE_PATHS.claudeDir, RELATIVE_PATHS.codexDir, RELATIVE_PATHS.report]) {
    const source = path.join(cwd, relative);
    if (!existsSync(source)) continue;
    const target = path.join(backupDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (statSync(source).isDirectory()) await cp(source, target, { recursive: true });
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

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashPath(target) {
  if (!existsSync(target)) return undefined;
  const stats = statSync(target);
  if (!stats.isDirectory()) return hashText(readFileSync(target));

  const hash = createHash("sha256");
  hash.update("dir\n");
  for (const name of readdirSync(target).sort()) {
    const child = path.join(target, name);
    hash.update(`${name}\0${hashPath(child)}\n`);
  }
  return hash.digest("hex");
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
      await cp(source, target, { recursive: true });
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

  if (!options.yes) {
    throw new Error("Refusing to write without --yes. Run with --dry-run first, then add --yes.");
  }

  assertNoUnsafeOverwrites(changes, options.cwd, options.force);

  const backupDir = await makeBackup(options.cwd, changes);
  for (const change of fileChanges(changes)) {
    await mkdir(path.dirname(change.path), { recursive: true });
    if (change.kind === "copy-dir") await cp(change.from, change.path, { recursive: true });
    else await writeFile(change.path, change.content, "utf8");
  }
  return { backupDir, changes };
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
  if (Object.keys(mcp).length > 0) {
    const current = readText(files.codexConfig) ?? "";
    const analysis = analyzeClaudeMcp(mcp, codexMcpNames(current));
    manualReviews.push(...analysis.manualReviews);
    changes.push(...analysis.planItems);
    if (Object.keys(analysis.supported).length > 0) {
      const migratedBlock = `\n# Migrated from Claude MCP settings by ai-switch.\n${toCodexToml(analysis.supported)}`;
      changes.push({
        kind: "write",
        path: files.codexConfig,
        content: mergeCodexConfig(current, migratedBlock)
      });
    }
  }

  const claudeSkills = files.claudeSkills;
  if (existsSync(claudeSkills)) {
    changes.push({ kind: "copy-dir", from: claudeSkills, path: files.codexSkills });
  }

  changes.push(reportChange(cwd, "cc", "codex", changes, manualReviews));
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
  if (Object.keys(mcp).length > 0) {
    changes.push({
      kind: "write",
      path: files.mcpJson,
      content: `${JSON.stringify({ mcpServers: mcp }, null, 2)}\n`
    });
  }

  const codexSkills = files.codexSkills;
  if (existsSync(codexSkills)) {
    changes.push({ kind: "copy-dir", from: codexSkills, path: files.claudeSkills });
  }

  changes.push(reportChange(cwd, "codex", "cc", changes, manualReviews));
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

function reportChange(cwd, from, to, changes, manualReviews = []) {
  const lines = [
    `# ai-switch migration report`,
    "",
    `- from: ${from}`,
    `- to: ${to}`,
    `- generated: ${new Date().toISOString()}`,
    "",
    "## Planned changes",
    "",
    ...fileChanges(changes).map((change) => `- ${change.kind}: ${path.relative(cwd, change.path)}`),
    "",
    "## Manual review needed",
    "",
    ...(manualReviews.length > 0 ? manualReviews.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Notes",
    "",
    "- Secrets and account sessions are intentionally not migrated.",
    "- MCP commands, args, and env values are copied as configuration data; verify paths and tokens before use.",
    "- Skills are copied as files, but runtime compatibility depends on each agent."
  ];
  return {
    kind: "write",
    path: projectPaths(cwd).report,
    content: `${lines.join("\n")}\n`,
    manualReviews
  };
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
  if (relative === RELATIVE_PATHS.report) return { action: "report", label: relative };
  if (change.kind === "copy-dir") {
    return {
      action: existsSync(change.path) ? "merge" : "copy",
      label: `${path.relative(cwd, change.from)} -> ${relative}`
    };
  }
  if (!existsSync(change.path)) return { action: "create", label: relative };
  if (relative === RELATIVE_PATHS.codexConfig) return { action: "update", label: relative };
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
  return [
    `Project: ${result.cwd}`,
    formatProviderStatus("Claude Code", result.claude, cwd, RELATIVE_PATHS.claudeMd),
    formatProviderStatus("Codex", result.codex, cwd, RELATIVE_PATHS.agentsMd),
    `Backups: ${backups}`,
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
    console.log("0.1.0");
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
  else if (command === "backup") console.log(await makeBackup(args.cwd));
  else if (command === "backups") {
    const backups = listBackups(args.cwd);
    console.log(backups.length > 0 ? backups.join("\n") : "No ai-switch backups found.");
  }
  else if (command === "restore") {
    const selector = from ?? "latest";
    const restored = await restoreBackup(args.cwd, selector, { force: args.force });
    console.log(`restored from backup: ${restored}`);
  }
  else if (command === "convert") {
    const result = await convert(from, to, args);
    console.log(args.dryRun ? "dry-run complete" : `migrated with backup: ${result.backupDir}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

function validateScopeOptions(command, args) {
  if (args.home && !args.global) throw new Error("--home requires --global.");
  if (args.global && command !== "status") throw new Error("--global is currently supported only for status.");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
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
  restoreBackup,
  status,
  toCodexToml
};
