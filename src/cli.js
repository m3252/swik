#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyTree,
  listBackups,
  listGlobalBackups,
  makeBackup,
  makeGlobalBackup,
  refreshCreatedHashes,
  restoreBackup,
  restoreGlobalBackup
} from "./backups.js";
import { fileChanges } from "./changes.js";
import { createHandoff, generateHandoff } from "./handoff.js";
import { compileInstructions } from "./instructions.js";
import { listDir, readJson, readText } from "./io.js";
import {
  analyzeClaudeMcp,
  analyzeClaudeMcpSources,
  analyzeCodexMcp,
  analyzeCodexMcpFromToml,
  codexMcpNames,
  collectCredentials,
  countCodexMcpServers,
  countMcpServers,
  credentialLines,
  extractClaudeMcp,
  extractCodexMcp,
  globalConfigScanList,
  literalEnvNamesInConfigs,
  projectConfigScanList,
  toClaudeMcpServers,
  toCodexToml,
  withReferencedEnv
} from "./mcp.js";
import { RELATIVE_PATHS, codexSkillSources, globalPathsFor, projectPaths } from "./paths.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");

const ROOT = process.cwd();
const SUPPORTED = new Set(["cc", "claude", "claude-code", "codex"]);
const MIGRATION_HEADER = /^# Project Instructions\n\nMigrated from (CLAUDE\.md|AGENTS\.md) by (?:swik|ai-switch)\.\n\n/;
const COMPILED_HEADER = /^# Project Instructions\n\nCompiled from Claude Code by (?:swik|ai-switch) \(-{2}compile\)\.\n\n/;

function skillCopyChanges(sources, target) {
  return sources.filter((source) => existsSync(source)).map((source) => ({ kind: "copy-dir", from: source, path: target }));
}

function countSkillDirs(dirs) {
  return dirs.reduce((total, dir) => total + listDir(dir).length, 0);
}

function usage() {
  const bin = "swik";
  return `${bin}

Usage:
  ${bin} detect [--cwd <path>]
  ${bin} status [--cwd <path>]
  ${bin} status --global [--home <path>]
  ${bin} audit [--cwd <path>]
  ${bin} doctor [--cwd <path>]
  ${bin} sync [--cwd <path>] [--compile] [--include-local] [--dry-run] [--yes] [--force]
  ${bin} handoff [--cwd <path>] [--output CODEX-HANDOFF.md] [--stdout] [--force] [--from <cc|codex>] [--to <cc|codex>]
  ${bin} backup [--cwd <path>]
  ${bin} backups [--cwd <path>] [--global [--home <path>]]
  ${bin} restore <latest|timestamp> [--cwd <path>] [--force] [--global [--home <path>]]
  ${bin} convert <cc|codex> <cc|codex> [--cwd <path>] [--dry-run] [--yes] [--force]
  ${bin} convert cc codex --compile [--include-local] [--dry-run] [--yes]
  ${bin} convert <cc|codex> <cc|codex> --global [--home <path>] [--dry-run] [--yes] [--force]
  ${bin} --version

Examples:
  ${bin} status
  ${bin} audit
  ${bin} sync --compile --dry-run
  ${bin} sync --compile --yes
  ${bin} convert cc codex --compile --dry-run
  ${bin} convert cc codex --compile --yes
  ${bin} convert codex cc --dry-run
  ${bin} convert codex cc --yes
  ${bin} handoff
  ${bin} handoff --stdout
  ${bin} status --global
  ${bin} convert cc codex --global --dry-run
  ${bin} backups --global
  ${bin} restore latest --global
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
    else if (arg === "--output") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--output requires a path value.");
      args.output = value;
    }
    else if (arg === "--stdout") args.stdout = true;
    else if (arg === "--from") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--from requires a value (cc, claude, claude-code, or codex).");
      args.handoffFrom = value;
    }
    else if (arg === "--to") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--to requires a value (cc, claude, claude-code, or codex).");
      args.handoffTo = value;
    }
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--global") args.global = true;
    else if (arg === "--compile") args.compile = true;
    else if (arg === "--include-local") args.includeLocal = true;
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

async function convert(fromRaw, toRaw, options) {
  const from = normalizeProvider(fromRaw);
  const to = normalizeProvider(toRaw);
  if (from === to) throw new Error("Source and target providers are the same.");

  const changes = from === "cc"
    ? planCcToCodex(options.cwd, options)
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
  await ensureProjectLocalIgnores(options.cwd);

  const backupDir = await makeBackup(options.cwd, changes);
  for (const change of fileChanges(changes)) {
    await mkdir(path.dirname(change.path), { recursive: true });
    if (change.kind === "copy-dir") await copyTree(change.from, change.path);
    else await writeFile(change.path, change.content, "utf8");
  }
  await refreshCreatedHashes(backupDir, (relative) => path.join(options.cwd, relative));
  return { backupDir, changes };
}

async function sync(cwd, options = {}) {
  const changes = planSync(cwd, options);

  if (options.dryRun) {
    printPlan(changes, cwd);
    return { backupDir: null, changes };
  }

  assertProjectWriteScope(cwd);

  if (!options.yes) {
    throw new Error("Refusing to write without --yes. Run with --dry-run first, then add --yes.");
  }

  assertNoUnsafeSyncOverwrites(changes, cwd, options.force);
  await ensureProjectLocalIgnores(cwd);

  const backupDir = await makeBackup(cwd, changes);
  for (const change of fileChanges(changes)) {
    await mkdir(path.dirname(change.path), { recursive: true });
    if (change.kind === "copy-dir") await copyTree(change.from, change.path);
    else await writeFile(change.path, change.content, "utf8");
  }
  await refreshCreatedHashes(backupDir, (relative) => path.join(cwd, relative));
  return { backupDir, changes };
}

async function handoff(cwd, options = {}) {
  if (!options.stdout) assertProjectWriteScope(cwd);
  return createHandoff(cwd, options);
}

// ---------------------------------------------------------------------------
// Global (home-level) convert. Operates ONLY on the allowlisted files in
// ~/.claude and ~/.codex (never whole directories). Same secret policy as
// project convert: literal env values become $NAME references. Backups live in
// ~/.swik/backups/global with a "global" manifest scope.
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
      const migratedBlock = `\n# Migrated from Claude MCP settings by swik.\n${toCodexToml(withReferencedEnv(analysis.supported))}`;
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

function assertProjectWriteScope(cwd) {
  if (!isHomeDirectory(cwd)) return;
  throw new Error("Refusing project migration in your home directory. Run convert/backup/restore inside a project directory, or use `--global` for home-level config (e.g. `swik convert cc codex --global`).");
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

async function ensureProjectLocalIgnores(cwd) {
  const git = gitContext(cwd);
  if (!git) return;
  const prefix = git.prefix;

  const entries = [
    {
      pattern: `${prefix}${RELATIVE_PATHS.backupDir}/`,
      checkPath: `${prefix}${RELATIVE_PATHS.backupDir}/.keep`
    },
    {
      pattern: `${prefix}${RELATIVE_PATHS.report}`,
      checkPath: `${prefix}${RELATIVE_PATHS.report}`
    }
  ].filter((entry) => entry.pattern && entry.checkPath && !gitCheckIgnored(git.root, entry.checkPath));

  if (entries.length === 0) return;

  const excludePath = path.join(git.gitDir, "info", "exclude");
  const current = readText(excludePath) ?? "";
  const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = entries.filter((entry) => !existing.has(entry.pattern));
  if (missing.length === 0) return;

  let next = current;
  if (next && !next.endsWith("\n")) next += "\n";
  if (!existing.has("# swik local ignores")) next += "# swik local ignores\n";
  for (const entry of missing) next += `${entry.pattern}\n`;

  await mkdir(path.dirname(excludePath), { recursive: true });
  await writeFile(excludePath, next, "utf8");
}

function gitContext(cwd) {
  try {
    const root = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
    const prefix = gitOutput(cwd, ["rev-parse", "--show-prefix"]);
    return { root: realPathOrResolve(root), gitDir: gitDir(cwd), prefix };
  } catch {
    return null;
  }
}

function gitDir(cwd) {
  try {
    return path.resolve(gitOutput(cwd, ["rev-parse", "--absolute-git-dir"]));
  } catch {
    const raw = gitOutput(cwd, ["rev-parse", "--git-dir"]);
    return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  }
}

function gitOutput(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function gitCheckIgnored(root, relativePath) {
  try {
    execFileSync("git", ["-C", root, "check-ignore", "--quiet", "--", relativePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function relativePath(baseDir, target) {
  return path.relative(baseDir, target).split(path.sep).join("/");
}

function planCcToCodex(cwd, options = {}) {
  const files = projectPaths(cwd);
  const changes = [];
  const manualReviews = [];
  let compiled;
  if (options.compile) {
    compiled = compileInstructions(cwd, { includeLocal: options.includeLocal });
    if (compiled.content) changes.push({ kind: "write", path: files.agentsMd, content: compiled.content });
    manualReviews.push(...compiled.manualReviews);
  } else {
    const claudeMd = readText(files.claudeMd);
    if (claudeMd) changes.push({ kind: "write", path: files.agentsMd, content: migrateInstruction(claudeMd, "CLAUDE.md") });
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
      const migratedBlock = `\n# Migrated from Claude MCP settings by swik.\n${toCodexToml(withReferencedEnv(analysis.supported))}`;
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

  changes.push(reportChange(cwd, files.report, "cc", "codex", changes, manualReviews, credentials, reportAuditSurfaces(cwd, { ...options, compiled })));
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

  // No Claude-surface audit on codex -> cc: those are target-side, not source gaps.
  changes.push(reportChange(cwd, files.report, "codex", "cc", changes, manualReviews, credentials));
  return changes;
}

function planSync(cwd, options = {}) {
  const files = projectPaths(cwd);
  const changes = [];
  const manualReviews = [];
  const credentials = [];
  let compiled;

  const claudeMd = readText(files.claudeMd);
  const agentsMd = readText(files.agentsMd);
  if (options.compile && claudeMd) {
    compiled = compileInstructions(cwd, { includeLocal: options.includeLocal });
  }

  if (claudeMd && !agentsMd) {
    if (options.compile) {
      if (compiled.content) changes.push({ kind: "write", path: files.agentsMd, content: compiled.content });
      manualReviews.push(...compiled.manualReviews);
    } else {
      changes.push({ kind: "write", path: files.agentsMd, content: migrateInstruction(claudeMd, "CLAUDE.md") });
    }
  } else if (agentsMd && !claudeMd) {
    changes.push({ kind: "write", path: files.claudeMd, content: migrateInstruction(agentsMd, "AGENTS.md") });
  } else if (claudeMd && agentsMd) {
    if (options.compile) manualReviews.push(...compiled.manualReviews);
    const expectedInstruction = options.compile && compiled.content ? compiled.content : claudeMd;
    if (!sameInstructionContent(expectedInstruction, agentsMd)) {
      manualReviews.push("CLAUDE.md and AGENTS.md both exist and differ; sync will not overwrite either instruction file.");
      changes.push({ kind: "manual-review", label: "instructions", reason: "CLAUDE.md and AGENTS.md differ." });
    }
  }

  const claudeSourceAnalysis = analyzeClaudeMcpSources(cwd);
  const claudeMcp = claudeSourceAnalysis.servers;
  manualReviews.push(...claudeSourceAnalysis.manualReviews);
  changes.push(...claudeSourceAnalysis.planItems);

  const currentCodex = readText(files.codexConfig) ?? "";
  const claudeToCodex = analyzeClaudeMcp(claudeMcp, codexMcpNames(currentCodex));
  manualReviews.push(...claudeToCodex.manualReviews);
  changes.push(...claudeToCodex.planItems);
  if (Object.keys(claudeToCodex.supported).length > 0) {
    credentials.push(...collectCredentials(claudeToCodex.supported));
    const migratedBlock = `\n# Synced from Claude MCP settings by swik.\n${toCodexToml(withReferencedEnv(claudeToCodex.supported))}`;
    changes.push({ kind: "write", path: files.codexConfig, content: mergeCodexConfig(currentCodex, migratedBlock) });
  }

  const codexAnalysis = analyzeCodexMcp(cwd);
  manualReviews.push(...codexAnalysis.manualReviews);
  changes.push(...codexAnalysis.planItems);
  credentials.push(...collectCredentials(codexAnalysis.servers));
  const missingClaudeServers = missingClaudeMcpServers(claudeMcp, codexAnalysis.servers, manualReviews);
  if (Object.keys(missingClaudeServers).length > 0) {
    const mcpJson = readJson(files.mcpJson);
    if (mcpJson?.__parseError) {
      manualReviews.push(`.mcp.json could not be parsed (${mcpJson.__parseError}); Codex MCP servers were not synced to Claude.`);
    } else {
      const base = mcpJson && typeof mcpJson === "object" ? mcpJson : {};
      const existing = base.mcpServers && typeof base.mcpServers === "object" ? base.mcpServers : {};
      changes.push({
        kind: "write",
        path: files.mcpJson,
        content: `${JSON.stringify({ ...base, mcpServers: { ...existing, ...toClaudeMcpServers(missingClaudeServers) } }, null, 2)}\n`
      });
    }
  }

  changes.push(...skillSyncChanges(files.claudeSkills, files.agentsSkills, manualReviews, ".claude/skills", ".agents/skills"));
  changes.push(...skillSyncChanges(files.agentsSkills, files.claudeSkills, manualReviews, ".agents/skills", ".claude/skills"));

  changes.push(reportChange(cwd, files.report, "sync", "sync", changes, manualReviews, credentials, reportAuditSurfaces(cwd, { ...options, compiled })));
  return changes;
}

function missingClaudeMcpServers(existingClaude, codexServers, manualReviews) {
  const missing = {};
  for (const [name, server] of Object.entries(codexServers)) {
    if (Object.hasOwn(existingClaude, name)) {
      manualReviews.push(`MCP server "${name}" exists on both sides; sync did not overwrite either definition.`);
      continue;
    }
    missing[name] = server;
  }
  return missing;
}

function skillSyncChanges(fromDir, toDir, manualReviews, fromLabel, toLabel) {
  if (!existsSync(fromDir)) return [];
  const changes = [];
  for (const name of readdirSync(fromDir).sort()) {
    const from = path.join(fromDir, name);
    const to = path.join(toDir, name);
    if (!existsSync(to)) {
      changes.push({ kind: "copy-dir", from, path: to });
      continue;
    }
    if (!samePathContent(from, to)) {
      manualReviews.push(`${fromLabel}/${name} and ${toLabel}/${name} both exist and differ; sync did not overwrite either skill.`);
      changes.push({ kind: "manual-review", label: `skills: ${name}`, reason: `${fromLabel}/${name} differs from ${toLabel}/${name}.` });
    }
  }
  return changes;
}

function samePathContent(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false;
  const leftStat = lstatSync(left);
  const rightStat = lstatSync(right);
  if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) return leftStat.isSymbolicLink() && rightStat.isSymbolicLink();
  if (leftStat.isFile() || rightStat.isFile()) {
    return leftStat.isFile() && rightStat.isFile() && readFileSync(left).equals(readFileSync(right));
  }
  if (!leftStat.isDirectory() || !rightStat.isDirectory()) return false;
  const leftNames = readdirSync(left).sort();
  const rightNames = readdirSync(right).sort();
  if (leftNames.length !== rightNames.length) return false;
  for (let i = 0; i < leftNames.length; i += 1) {
    if (leftNames[i] !== rightNames[i]) return false;
    if (!samePathContent(path.join(left, leftNames[i]), path.join(right, rightNames[i]))) return false;
  }
  return true;
}

function migrateInstruction(content, sourceName) {
  let body = content.trim();
  while (MIGRATION_HEADER.test(body)) {
    body = body.replace(MIGRATION_HEADER, "").trim();
  }
  return `# Project Instructions\n\nMigrated from ${sourceName} by swik.\n\n${body}\n`;
}

function sameInstructionContent(left, right) {
  return normalizeInstructionForSync(left) === normalizeInstructionForSync(right);
}

function normalizeInstructionForSync(content) {
  let body = content.trim();
  while (MIGRATION_HEADER.test(body)) {
    body = body.replace(MIGRATION_HEADER, "").trim();
  }
  if (COMPILED_HEADER.test(body)) {
    body = body.replace(COMPILED_HEADER, "").trim();
    const sections = [...body.matchAll(/^## From [^\n]+\n\n([\s\S]*?)(?=\n\n## From [^\n]+\n\n|$)/gm)];
    if (sections.length > 0) {
      body = sections.map((section) => section[1].trim()).join("\n\n").trim();
    }
  }
  return body;
}

function mergeCodexConfig(current, migratedBlock) {
  if (!current.trim()) return migratedBlock.trimStart();
  return `${current.trimEnd()}\n${migratedBlock}`;
}

function reportChange(baseDir, reportPath, from, to, changes, manualReviews = [], credentials = [], audit = []) {
  const auditGaps = auditGapLines(audit);
  const lines = [
    `# swik migration report`,
    "",
    `- from: ${from}`,
    `- to: ${to}`,
    `- generated: ${new Date().toISOString()}`,
    "",
    "## Planned changes",
    "",
    ...fileChanges(changes).map((change) => `- ${change.kind}: ${relativePath(baseDir, change.path)}`),
    "",
    "## Manual review needed",
    "",
    ...(manualReviews.length > 0 ? manualReviews.map((item) => `- ${item}`) : ["- None"]),
    "",
    ...(auditGaps.length > 0 ? [
      "## Other Claude surfaces detected (not auto-migrated)",
      "",
      "swik migrates instructions, MCP, and skills. These additional surfaces were found and need manual attention — run `swik audit` for the full list:",
      "",
      ...auditGaps,
      ""
    ] : []),
    "## Environment variables needed",
    "",
    "swik never copies literal env values into target configs or reports. Set these variables in the target tool's environment before the migrated MCP servers will run:",
    "",
    ...credentialLines(credentials),
    "",
    "## Notes",
    "",
    "- Secrets and account sessions are intentionally not migrated.",
    "- Literal env values are replaced with `$NAME` in the migrated config and this report; they are never written into the target tool. Verify paths before use.",
    "- Backups preserve your original allowlisted files. Project writes add `.swik-backups/` and `swik-report.md` to `.git/info/exclude` when run inside a Git worktree; global backups live outside the project at `~/.swik/backups/global/`. If backed-up files contain literal secrets, the backup will too.",
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

function reportAuditSurfaces(cwd, options = {}) {
  const surfaces = auditSurfaces(cwd);
  if (!options.compile) return surfaces;

  const compiledSources = new Set(options.compiled?.sources ?? []);
  return surfaces.filter((surface) => !isCompiledInstructionSurface(surface.surface, compiledSources));
}

function isCompiledInstructionSurface(surface, compiledSources) {
  if (surface === ".claude/CLAUDE.md") return compiledSources.has(".claude/CLAUDE.md");
  if (surface === "CLAUDE.local.md") return compiledSources.has("CLAUDE.local.md");
  if (surface === ".claude/rules") return [...compiledSources].some((source) => source.startsWith(".claude/rules/"));
  return false;
}

function assertNoUnsafeOverwrites(changes, cwd, force = false) {
  const unsafe = fileChanges(changes)
    .filter((change) => isUnsafeOverwrite(change, cwd))
    .map((change) => relativePath(cwd, change.path));
  if (unsafe.length > 0 && !force) {
    throw new Error(`Refusing to overwrite existing files without --force: ${unsafe.join(", ")}`);
  }
}

function assertNoUnsafeSyncOverwrites(changes, cwd, force = false) {
  const mergeSafe = new Set([RELATIVE_PATHS.report, RELATIVE_PATHS.codexConfig, RELATIVE_PATHS.mcpJson, RELATIVE_PATHS.claudeSettings]);
  const unsafe = fileChanges(changes)
    .filter((change) => existsSync(change.path) && !mergeSafe.has(relativePath(cwd, change.path)))
    .map((change) => relativePath(cwd, change.path));
  if (unsafe.length > 0 && !force) {
    throw new Error(`Refusing to overwrite existing files without --force: ${unsafe.join(", ")}`);
  }
}

function isUnsafeOverwrite(change, cwd) {
  if (!existsSync(change.path)) return false;
  const relative = relativePath(cwd, change.path);
  if (relative === RELATIVE_PATHS.report) return false;
  if (relative === RELATIVE_PATHS.codexConfig) return false;
  return true;
}

function planLabel(change, cwd) {
  if (change.kind === "skip" || change.kind === "manual-review") {
    return { action: change.kind, label: change.label, reason: change.reason };
  }
  const relative = relativePath(cwd, change.path);
  if (change.report || relative === RELATIVE_PATHS.report) return { action: "report", label: relative };
  if (change.kind === "copy-dir") {
    return {
      action: existsSync(change.path) ? "merge" : "copy",
      label: `${relativePath(cwd, change.from)} -> ${relative}`
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
    ? ["Note: this is your home directory. For home-level config use `--global` (e.g. `swik convert cc codex --global`); run project conversions inside a project directory."]
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
  const mcp = config ? `${plural(provider.mcpServerCount, "MCP server")} (${relativePath(cwd, config)})` : "no MCP config";
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
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return `~/${relative.split(path.sep).join("/")}`;
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
  const auditGaps = auditSurfaces(cwd).filter((surface) => surface.status !== "migrated");
  if (auditGaps.length > 0) {
    warnings.push(`${auditGaps.length} Claude surface(s) won't auto-migrate (run \`swik audit\` for the full list).`);
  }
  return { result, problems, warnings, suggestions: doctorSuggestions(result, problems, warnings, auditGaps) };
}

function doctorSuggestions(result, problems, warnings, auditGaps) {
  const suggestions = [];
  if (problems.length > 0) {
    if (result.parseErrors.length > 0) suggestions.push("Fix parse errors before running a migration.");
    if (!result.claude.instructionFile && !result.codex.instructionFile) suggestions.push("Run `swik status` from a project root, or add CLAUDE.md / AGENTS.md first.");
  }

  const hasClaude = Boolean(result.claude.instructionFile || result.claude.settingsFile || result.claude.mcpFile || result.claude.skillsDir);
  const hasCodex = Boolean(result.codex.instructionFile || result.codex.configFile || result.codex.skillsDir);
  if (hasClaude && !result.codex.instructionFile) suggestions.push("Preview Claude Code -> Codex with `swik convert cc codex --compile --dry-run`.");
  if (hasCodex && !result.claude.instructionFile) suggestions.push("Preview Codex -> Claude Code with `swik convert codex cc --dry-run`.");

  if (auditGaps.length > 0) suggestions.push("Run `swik audit` to see which Claude Code surfaces need manual migration.");
  if (warnings.includes("No MCP config found.")) suggestions.push("If this project uses MCP, add .mcp.json or .codex/config.toml before converting.");

  return [...new Set(suggestions)];
}

function doctor(cwd) {
  const { result, problems, warnings, suggestions } = doctorReport(cwd);
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
  if (suggestions.length > 0) {
    console.log("\nSuggested next commands:");
    for (const suggestion of suggestions) console.log(`- ${suggestion}`);
  }
}

// Detect Claude Code surfaces beyond the three swik migrates (instructions,
// MCP, skills) and classify each: migrated (auto), manual (detected, needs hand
// work in Codex), or unsupported (no Codex equivalent). This is what makes the
// tool honest about its scope instead of implying a full one-to-one port.
function auditSurfaces(cwd) {
  const files = projectPaths(cwd);
  const surfaces = [];
  const has = (...rel) => existsSync(path.join(cwd, ...rel));
  const countEntries = (...rel) => {
    const dir = path.join(cwd, ...rel);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((name) => {
      if (name.endsWith(".md")) return true;
      // Follow symlinks (Claude Code loads with ripgrep --follow), but guard so a
      // broken symlink is skipped instead of crashing audit/doctor with ENOENT.
      try {
        return statSync(path.join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    }).length;
  };

  if (has(RELATIVE_PATHS.claudeMd)) surfaces.push({ status: "migrated", surface: "CLAUDE.md", detail: "root instructions → AGENTS.md" });

  // Drive MCP classification from the real convert analysis, not a raw count, so
  // that http servers with auth (migrated, but auth is manual), sse/ws (rejected),
  // and cross-source duplicates all surface — count-based logic missed those.
  const sourceAnalysis = analyzeClaudeMcpSources(cwd);
  const sources = sourceAnalysis.servers;
  if (Object.keys(sources).length > 0 || sourceAnalysis.planItems.length > 0) {
    const analysis = analyzeClaudeMcp(sources, codexMcpNames(readText(files.codexConfig) ?? ""));
    const migratedCount = Object.keys(analysis.supported).length;
    if (migratedCount > 0) surfaces.push({ status: "migrated", surface: "MCP servers", detail: `${migratedCount} server(s) (stdio/http) → .codex/config.toml` });
    const flagged = new Set([...sourceAnalysis.planItems, ...analysis.planItems]
      .filter((item) => item.kind === "manual-review" || item.kind === "skip")
      .map((item) => String(item.label).replace(/^mcp: /, "")));
    if (flagged.size > 0) surfaces.push({ status: "manual", surface: "MCP servers (need manual attention)", detail: `${flagged.size} server(s): ${[...flagged].join(", ")} — transport/auth/duplicate/paths; see the report` });
  }

  if (has(RELATIVE_PATHS.claudeSkills)) surfaces.push({ status: "migrated", surface: ".claude/skills", detail: "→ .agents/skills" });

  if (has(".claude", "CLAUDE.md")) surfaces.push({ status: "manual", surface: ".claude/CLAUDE.md", detail: "nested instructions are not merged into AGENTS.md" });
  if (has("CLAUDE.local.md")) surfaces.push({ status: "manual", surface: "CLAUDE.local.md", detail: "local/private instructions are not migrated" });
  const rules = countEntries(".claude", "rules");
  if (rules > 0) surfaces.push({ status: "manual", surface: ".claude/rules", detail: `${rules} file(s); rules are not merged into AGENTS.md` });
  const agents = countEntries(".claude", "agents");
  if (agents > 0) surfaces.push({ status: "manual", surface: ".claude/agents", detail: `${agents} custom agent(s) use tools/model/hooks; rebuild in Codex manually` });
  const commands = countEntries(".claude", "commands");
  if (commands > 0) surfaces.push({ status: "manual", surface: ".claude/commands", detail: `${commands} slash command(s); no direct Codex equivalent` });

  const settings = readJson(files.claudeSettings);
  if (settings && !settings.__parseError) {
    const nonMcp = Object.keys(settings).filter((key) => key !== "mcpServers");
    if (nonMcp.length > 0) surfaces.push({ status: "manual", surface: ".claude/settings.json", detail: `non-MCP keys not migrated: ${nonMcp.join(", ")}` });
  }
  // Claude also reads local/private settings from .claude/settings.local.json.
  if (has(".claude", "settings.local.json")) surfaces.push({ status: "manual", surface: ".claude/settings.local.json", detail: "local/private settings (hooks/permissions/env) are not migrated" });

  if (has(".claude", "output-styles")) surfaces.push({ status: "unsupported", surface: ".claude/output-styles", detail: "no Codex equivalent" });
  if (has(".claude", "workflows")) surfaces.push({ status: "unsupported", surface: ".claude/workflows", detail: "no Codex equivalent" });

  return surfaces;
}

function formatAudit(cwd) {
  const surfaces = auditSurfaces(cwd);
  const groups = [
    ["Migrated automatically", "migrated", "✓"],
    ["Needs manual migration", "manual", "!"],
    ["Not portable", "unsupported", "✗"]
  ];
  const lines = [`Audit: ${cwd}`];
  for (const [title, status, mark] of groups) {
    const items = surfaces.filter((surface) => surface.status === status);
    if (items.length === 0) continue;
    lines.push("", `${title}:`);
    for (const item of items) lines.push(`  ${mark} ${item.surface} — ${item.detail}`);
  }
  if (surfaces.length === 0) lines.push("", "No Claude Code surfaces detected.");
  return lines.join("\n");
}

// Report lines for surfaces that swik did NOT auto-migrate (the gaps).
function auditGapLines(surfaces) {
  const gaps = surfaces.filter((surface) => surface.status !== "migrated");
  if (gaps.length === 0) return [];
  return gaps.map((surface) => `- ${surface.surface} (${surface.status}): ${surface.detail}`);
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
  else if (command === "audit") console.log(formatAudit(args.cwd));
  else if (command === "doctor") doctor(args.cwd);
  else if (command === "sync") {
    const result = await sync(args.cwd, args);
    console.log(args.dryRun ? "dry-run complete" : `synced with backup: ${result.backupDir}`);
  }
  else if (command === "handoff") {
    const result = await handoff(args.cwd, args);
    if (args.stdout) console.log(result.content.trimEnd());
    else console.log(`created handoff: ${result.path}`);
  }
  else if (command === "backup") {
    assertProjectWriteScope(args.cwd);
    await ensureProjectLocalIgnores(args.cwd);
    console.log(await makeBackup(args.cwd));
  }
  else if (command === "backups") {
    const backups = args.global ? listGlobalBackups(args.home ?? homedir()) : listBackups(args.cwd);
    console.log(backups.length > 0 ? backups.join("\n") : "No swik backups found.");
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
  if (args.output && command !== "handoff") throw new Error("--output is only supported for handoff.");
  if (args.stdout && command !== "handoff") throw new Error("--stdout is only supported for handoff.");
  if (args.output && args.stdout) throw new Error("--output cannot be used with --stdout.");
  for (const [flag, value] of [["--from", args.handoffFrom], ["--to", args.handoffTo]]) {
    if (value === undefined) continue;
    if (command !== "handoff") throw new Error(`${flag} is only supported for handoff.`);
    if (!["cc", "claude", "claude-code", "codex"].includes(value)) throw new Error(`${flag} must be cc, claude, claude-code, or codex, got "${value}".`);
  }
  if (args.includeLocal && !args.compile) throw new Error("--include-local requires --compile.");
  if (args.compile) {
    const [, from, to] = args._;
    const fromIsClaude = ["cc", "claude", "claude-code"].includes(from);
    if (args.global || !((command === "convert" && fromIsClaude && to === "codex") || command === "sync")) {
      throw new Error("--compile is only supported for project `convert cc codex` and `sync`.");
    }
  }
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
  auditSurfaces,
  formatAudit,
  compileInstructions,
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
  planSync,
  planCcToCodexGlobal,
  planCodexToCcGlobal,
  convertGlobal,
  sync,
  generateHandoff,
  handoff,
  literalEnvNamesInConfigs,
  restoreBackup,
  restoreGlobalBackup,
  status,
  toCodexToml
};
