import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCodexMcp,
  analyzeClaudeMcpSources,
  auditSurfaces,
  compileInstructions,
  convert,
  detect,
  detectGlobal,
  doctorReport,
  extractCodexMcp,
  generateHandoff,
  handoff,
  listBackups,
  migrateInstruction,
  parseArgs,
  planLabel,
  planCcToCodex,
  planCodexToCc,
  planSync,
  planCcToCodexGlobal,
  convertGlobal,
  sync,
  restoreGlobalBackup,
  literalEnvNamesInConfigs,
  restoreBackup,
  status
} from "../src/cli.js";

function fixture() {
  return mkdtempSync(path.join(tmpdir(), "ai-switch-"));
}

function hasGit() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Run `fn` with $HOME pointed at `home` (so os.homedir() resolves there) and
// console.log silenced, then restore both. Keeps home-directory tests off the
// developer's real ~ and out of the test log.
async function withFakeHome(home, fn) {
  const originalHome = process.env.HOME;
  const originalLog = console.log;
  process.env.HOME = home;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    console.log = originalLog;
  }
}

test("detects Claude project files", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "skills"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use strict TypeScript.\n");
  writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({
    mcpServers: {
      docs: { command: "node", args: ["server.js"] }
    }
  }));

  const result = detect(dir);
  assert.equal(result.claude.skillCount, 0);
  assert.equal(result.claude.mcpServerCount, 1);
  assert.ok(result.claude.instructionFile.endsWith("CLAUDE.md"));
});

test("merges Claude MCP servers from settings and project mcp files", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({
    mcpServers: {
      settingsOnly: { command: "node", args: ["settings.js"] },
      duplicate: { command: "node", args: ["settings-duplicate.js"] }
    }
  }));
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      projectOnly: { command: "node", args: ["project.js"] },
      duplicate: { command: "node", args: ["project-duplicate.js"] }
    }
  }));

  const sourceAnalysis = analyzeClaudeMcpSources(dir);
  assert.deepEqual(Object.keys(sourceAnalysis.servers).sort(), ["duplicate", "projectOnly", "settingsOnly"]);
  assert.deepEqual(sourceAnalysis.servers.duplicate.args, ["settings-duplicate.js"]);
  assert.match(sourceAnalysis.manualReviews.join("\n"), /exists in multiple Claude MCP sources/);

  const changes = planCcToCodex(dir);
  const codexConfig = changes.find((change) => change.path?.endsWith(".codex/config.toml"));
  assert.match(codexConfig.content, /\[mcp_servers\."settingsOnly"\]/);
  assert.match(codexConfig.content, /\[mcp_servers\."projectOnly"\]/);
});

test("plans Claude to Codex instruction, MCP, skills, and report", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "skills", "review"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Review carefully.\n");
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      local: { command: "bunx", args: ["mcp-server"], env: { TOKEN: "x" } }
    }
  }));

  const changes = planCcToCodex(dir);
  assert.deepEqual(changes.map((change) => path.relative(dir, change.path)), [
    "AGENTS.md",
    ".codex/config.toml",
    ".agents/skills",
    "ai-switch-report.md"
  ]);
  assert.match(changes[1].content, /\[mcp_servers\."local"\]/);
});

test("parses Codex MCP and plans Codex to Claude", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), "Prefer small patches.\n");
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers."docs"]
command = "node"
args = ["server.js"]
env = { "TOKEN" = "abc" }
`);

  assert.deepEqual(extractCodexMcp(dir), {
    docs: { command: "node", args: ["server.js"], env: { TOKEN: "abc" } }
  });

  const changes = planCodexToCc(dir);
  const mcpJson = JSON.parse(changes.find((change) => change.path.endsWith(".mcp.json")).content);
  assert.equal(mcpJson.mcpServers.docs.command, "node");
  assert.equal(readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "Prefer small patches.\n");
});

test("sync plans safe missing surfaces in both directions", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "skills", "review"), { recursive: true });
  mkdirSync(path.join(dir, ".agents", "skills", "fmt"), { recursive: true });
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");
  writeFileSync(path.join(dir, ".claude", "skills", "review", "SKILL.md"), "Review skill.\n");
  writeFileSync(path.join(dir, ".agents", "skills", "fmt", "SKILL.md"), "Format skill.\n");
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      docs: { command: "node", args: ["docs.js"] }
    }
  }));
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers.remote]
url = "https://example.com/sse"
`);

  const changes = planSync(dir, { compile: true });
  const relatives = changes.filter((change) => change.path).map((change) => path.relative(dir, change.path));
  assert.ok(relatives.includes("AGENTS.md"));
  assert.ok(relatives.includes(".codex/config.toml"));
  assert.ok(relatives.includes(".mcp.json"));
  assert.ok(relatives.includes(".agents/skills/review"));
  assert.ok(relatives.includes(".claude/skills/fmt"));
  assert.ok(relatives.includes("ai-switch-report.md"));

  const codexConfig = changes.find((change) => change.path?.endsWith(".codex/config.toml")).content;
  assert.match(codexConfig, /\[mcp_servers\.remote\]/);
  assert.match(codexConfig, /\[mcp_servers\."docs"\]/);

  const mcpJson = JSON.parse(changes.find((change) => change.path?.endsWith(".mcp.json")).content);
  assert.equal(mcpJson.mcpServers.remote.type, "http");
  assert.equal(mcpJson.mcpServers.docs.command, "node");
});

test("sync reports instruction conflicts without overwriting either side", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Claude instructions.\n");
  writeFileSync(path.join(dir, "AGENTS.md"), "Codex instructions.\n");

  const changes = planSync(dir);
  assert.ok(changes.some((change) => change.kind === "manual-review" && change.label === "instructions"));
  assert.equal(changes.some((change) => change.path === path.join(dir, "CLAUDE.md")), false);
  assert.equal(changes.some((change) => change.path === path.join(dir, "AGENTS.md")), false);
});

test("sync is idempotent for instructions it generated", async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");

  await sync(dir, { compile: true, yes: true });
  const rerun = planSync(dir, { compile: true });

  assert.equal(rerun.some((change) => change.kind === "manual-review" && change.label === "instructions"), false);
  assert.equal(rerun.some((change) => change.path === path.join(dir, "AGENTS.md")), false);
});

test("parses multi-line Codex args and inline env with commas and equals", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers."multiline"]
command = "npx"
args = [
  "-y",
  "@scope/server",
  "--flag=with,comma"
]
env = { "TOKEN" = "a,b=c", "MODE" = "dev" }
`);

  assert.deepEqual(extractCodexMcp(dir), {
    multiline: {
      command: "npx",
      args: ["-y", "@scope/server", "--flag=with,comma"],
      env: { TOKEN: "a,b=c", MODE: "dev" }
    }
  });
});

test("inventories required credentials without leaking literal secret values", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      linear: { command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_API_KEY: "$LINEAR_API_KEY" } },
      github: { command: "docker", args: ["run", "mcp/github"], env: { GITHUB_TOKEN: "ghp_REALsecret123" } }
    }
  }));

  const changes = planCcToCodex(dir);
  const report = changes.find((change) => change.path?.endsWith("ai-switch-report.md")).content;
  assert.match(report, /## Environment variables needed/);
  assert.match(report, /LINEAR_API_KEY \(server: linear\) — referenced via env/);
  assert.match(report, /GITHUB_TOKEN \(server: github\) — source config had a literal value/);
  assert.doesNotMatch(report, /ghp_REALsecret123/);

  // P0: the literal secret must NOT be written into the target config either.
  const codexConfig = changes.find((change) => change.path?.endsWith(".codex/config.toml")).content;
  assert.doesNotMatch(codexConfig, /ghp_REALsecret123/);
  assert.match(codexConfig, /"GITHUB_TOKEN" = "\$GITHUB_TOKEN"/);
  assert.match(codexConfig, /"LINEAR_API_KEY" = "\$LINEAR_API_KEY"/);
});

test("merges nested [mcp_servers.x.env] tables and ignores unrelated tables", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers.node_repl]
command = "node"
args = [
  "repl.js", # entrypoint
  "--strict"
]

[mcp_servers.node_repl.env]
NODE_ENV = "dev"

[profiles.default]
model = "gpt-5"
`);

  const result = analyzeCodexMcp(dir);
  assert.deepEqual(result.servers, {
    node_repl: { command: "node", args: ["repl.js", "--strict"], env: { NODE_ENV: "dev" } }
  });
  // no phantom "node_repl.env" server and no false "model" unsupported-field review
  assert.equal(result.manualReviews.join("\n").includes("node_repl.env"), false);
  assert.equal(result.manualReviews.join("\n").includes("model"), false);
});

test("writes migration with backup only when confirmed", async () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");
  writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({
    mcpServers: {
      notes: { command: "node", args: ["notes.js"] }
    }
  }));

  await assert.rejects(
    () => convert("cc", "codex", { cwd: dir }),
    /Refusing to write/
  );

  const result = await convert("cc", "codex", { cwd: dir, yes: true });
  assert.ok(existsSync(path.join(dir, "AGENTS.md")));
  assert.ok(existsSync(path.join(dir, ".codex", "config.toml")));
  assert.ok(existsSync(path.join(result.backupDir, "CLAUDE.md")));
});

test("confirmed project writes locally gitignore backups and reports", async () => {
  if (!hasGit()) return;
  const dir = fixture();
  git(dir, ["init"]);
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");

  await convert("cc", "codex", { cwd: dir, yes: true });

  const exclude = readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^# ai-switch local ignores$/m);
  assert.match(exclude, /^\.ai-switch-backups\/$/m);
  assert.match(exclude, /^ai-switch-report\.md$/m);
  assert.doesNotThrow(() => git(dir, ["check-ignore", ".ai-switch-backups/example"]));
  assert.doesNotThrow(() => git(dir, ["check-ignore", "ai-switch-report.md"]));
});

test("local git ignores are scoped when writing from a repo subdirectory", async () => {
  if (!hasGit()) return;
  const dir = fixture();
  const app = path.join(dir, "packages", "app");
  mkdirSync(app, { recursive: true });
  git(dir, ["init"]);
  writeFileSync(path.join(app, "CLAUDE.md"), "Use short responses.\n");

  await convert("cc", "codex", { cwd: app, yes: true });

  const exclude = readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^packages\/app\/\.ai-switch-backups\/$/m);
  assert.match(exclude, /^packages\/app\/ai-switch-report\.md$/m);
  assert.doesNotThrow(() => git(dir, ["check-ignore", "packages/app/.ai-switch-backups/example"]));
  assert.doesNotThrow(() => git(dir, ["check-ignore", "packages/app/ai-switch-report.md"]));
});

test("sync writes safe missing targets with backup only when confirmed", async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");

  await assert.rejects(
    () => sync(dir, { compile: true }),
    /Refusing to write/
  );

  const result = await sync(dir, { compile: true, yes: true });
  assert.ok(existsSync(path.join(dir, "AGENTS.md")));
  assert.ok(existsSync(path.join(result.backupDir, "CLAUDE.md")));
});

test("refuses project writes in the home directory", async () => {
  const home = fixture();
  await withFakeHome(home, () => assert.rejects(
    () => convert("codex", "cc", { cwd: home, yes: true }),
    /Refusing project migration in your home directory/
  ));
});

test("allows read-only dry-run preview in the home directory", async () => {
  const home = fixture();
  const result = await withFakeHome(home, () => convert("codex", "cc", { cwd: home, dryRun: true }));
  assert.equal(result.backupDir, null);
  assert.ok(Array.isArray(result.changes));
});

test("refuses unsafe overwrites without force", async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");
  writeFileSync(path.join(dir, "AGENTS.md"), "Existing Codex instructions.\n");

  await assert.rejects(
    () => convert("cc", "codex", { cwd: dir, yes: true }),
    /Refusing to overwrite existing files without --force: AGENTS.md/
  );

  await convert("cc", "codex", { cwd: dir, yes: true, force: true });
  assert.match(readFileSync(path.join(dir, "AGENTS.md"), "utf8"), /Use short responses/);
});

test("allows Codex config merge without force while preserving existing content", async () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers."existing"]
command = "node"
args = ["existing.js"]
`);
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      migrated: { command: "node", args: ["migrated.js"] }
    }
  }));

  await convert("cc", "codex", { cwd: dir, yes: true });
  const config = readFileSync(path.join(dir, ".codex", "config.toml"), "utf8");

  assert.match(config, /\[mcp_servers\."existing"\]/);
  assert.match(config, /\[mcp_servers\."migrated"\]/);
});

test("restores latest backup and removes files created by migration", async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");

  await convert("cc", "codex", { cwd: dir, yes: true });
  assert.ok(existsSync(path.join(dir, "AGENTS.md")));
  assert.equal(listBackups(dir).length, 1);

  await restoreBackup(dir, "latest");
  assert.equal(existsSync(path.join(dir, "AGENTS.md")), false);
  assert.equal(readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), "Use short responses.\n");
});

test("restore prunes empty directories created by migration", async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      notes: { command: "node", args: ["notes.js"] }
    }
  }));

  await convert("cc", "codex", { cwd: dir, yes: true });
  assert.ok(existsSync(path.join(dir, ".codex")));

  await restoreBackup(dir, "latest");
  assert.equal(existsSync(path.join(dir, ".codex")), false);
});

test("skips special files while backing up and copying skill directories", async () => {
  const dir = fixture();
  const specialDir = path.join(dir, ".codex", "skills", ".git");
  const specialPath = path.join(specialDir, "fsmonitor--daemon.ipc");
  mkdirSync(specialDir, { recursive: true });
  writeFileSync(path.join(dir, ".codex", "skills", "SKILL.md"), "Codex skill.\n");
  execFileSync("mkfifo", [specialPath]);

  await convert("codex", "cc", { cwd: dir, yes: true });

  assert.ok(existsSync(path.join(dir, ".claude", "skills", "SKILL.md")));
  assert.equal(existsSync(path.join(dir, ".claude", "skills", ".git", "fsmonitor--daemon.ipc")), false);
});

test("restore refuses to delete changed migration-created files without force", async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");

  await convert("cc", "codex", { cwd: dir, yes: true });
  writeFileSync(path.join(dir, "AGENTS.md"), "User edited generated instructions.\n");

  await assert.rejects(
    () => restoreBackup(dir, "latest"),
    /Refusing to remove changed migration-created path without --force: AGENTS.md/
  );
  assert.equal(readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "User edited generated instructions.\n");

  await restoreBackup(dir, "latest", { force: true });
  assert.equal(existsSync(path.join(dir, "AGENTS.md")), false);
});

test("doctor treats missing MCP as warning when instructions exist", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");

  const report = doctorReport(dir);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.warnings, ["No MCP config found."]);
  assert.match(report.suggestions.join("\n"), /swik convert cc codex --compile --dry-run/);
  assert.match(report.suggestions.join("\n"), /\.mcp\.json or \.codex\/config\.toml/);
});

test("doctor CLI prints suggested next commands", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");

  const output = execFileSync(process.execPath, ["src/cli.js", "doctor", "--cwd", dir], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.match(output, /Suggested next commands:/);
  assert.match(output, /swik convert cc codex --compile --dry-run/);
});

test("status returns a human-readable project summary", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Use short responses.\n");
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      notes: { command: "node", args: ["notes.js"] }
    }
  }));

  const output = status(dir);
  assert.match(output, /Project:/);
  assert.match(output, /Claude Code\s+CLAUDE.md, 1 MCP server \(.mcp.json\), no skills/);
  assert.match(output, /Codex\s+no AGENTS.md, no MCP config, no skills/);
  assert.match(output, /Backups: 0/);
});

test("global status reads home-level agent settings without project instructions", () => {
  const home = fixture();
  mkdirSync(path.join(home, ".claude", "skills", "review"), { recursive: true });
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "Global Claude memory.\n");
  writeFileSync(path.join(home, ".codex", "AGENTS.md"), "Global Codex memory.\n");
  writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({
    mcpServers: {
      docs: { command: "node", args: ["docs.js"] },
      notes: { command: "node", args: ["notes.js"] }
    }
  }));
  writeFileSync(path.join(home, ".codex", "config.toml"), `
[mcp_servers."local"]
command = "node"
args = ["server.js"]
`);

  const output = status(undefined, { global: true, home });
  assert.match(output, new RegExp(`Global: ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Claude Code\s+CLAUDE.md, 2 MCP servers \(~\/.claude\/settings.json\), 1 skill/);
  assert.match(output, /Codex\s+AGENTS.md, 1 MCP server \(~\/.codex\/config.toml\), no skills/);
  assert.match(output, /Backups: 0/);

  const result = detectGlobal(home);
  assert.equal(result.claude.mcpServerCount, 2);
  assert.equal(result.codex.mcpServerCount, 1);
});

test("global status honors provider-specific config environment overrides", () => {
  const home = fixture();
  const claudeRoot = path.join(fixture(), "custom-claude");
  const codexRoot = path.join(fixture(), "custom-codex");
  mkdirSync(path.join(claudeRoot, "skills", "review"), { recursive: true });
  mkdirSync(codexRoot, { recursive: true });
  writeFileSync(path.join(claudeRoot, "CLAUDE.md"), "Global Claude memory.\n");
  writeFileSync(path.join(claudeRoot, "settings.json"), JSON.stringify({
    mcpServers: {
      docs: { command: "node", args: ["docs.js"] }
    }
  }));
  writeFileSync(path.join(codexRoot, "AGENTS.md"), "Global Codex memory.\n");
  writeFileSync(path.join(codexRoot, "config.toml"), `
[mcp_servers."custom"]
command = "node"
args = ["custom.js"]
`);

  const env = { CLAUDE_CONFIG_DIR: claudeRoot, CODEX_HOME: codexRoot };
  const output = status(undefined, { global: true, home, env });

  assert.match(output, new RegExp(`Claude Code\\s+CLAUDE.md, 1 MCP server \\(${claudeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/settings.json\\), 1 skill`));
  assert.match(output, new RegExp(`Codex\\s+AGENTS.md, 1 MCP server \\(${codexRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/config.toml\\), no skills`));

  const result = detectGlobal(home, env);
  assert.equal(result.claude.settingsFile, path.join(claudeRoot, "settings.json"));
  assert.equal(result.codex.configFile, path.join(codexRoot, "config.toml"));
});

test("parses global and home options", () => {
  const args = parseArgs(["status", "--global", "--home", "/tmp/example-home"]);
  assert.equal(args.global, true);
  assert.equal(args.home, "/tmp/example-home");
});

test("parses handoff output options", () => {
  const args = parseArgs(["handoff", "--output", "docs/HANDOFF.md", "--force"]);
  assert.equal(args.output, "docs/HANDOFF.md");
  assert.equal(args.force, true);
});

test("package exposes ai-switch and swik binaries", () => {
  const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
  assert.equal(pkg.bin["ai-switch"], "src/cli.js");
  assert.equal(pkg.bin.swik, "src/cli.js");
});

test("swik alias prints swik-oriented help", () => {
  const dir = fixture();
  const aliasPath = path.join(dir, "swik");
  symlinkSync(path.resolve("src/cli.js"), aliasPath);

  const output = execFileSync(process.execPath, [aliasPath, "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.match(output, /^swik\n/);
  assert.match(output, /Alias: ai-switch/);
  assert.match(output, /swik convert cc codex --compile --dry-run/);
});

test("rejects unknown options", () => {
  assert.throws(
    () => parseArgs(["convert", "cc", "codex", "--frce"]),
    /Unknown option: --frce/
  );
});

test("rejects compile flags outside project cc->codex compile mode", () => {
  const cli = (args) => execFileSync(process.execPath, ["src/cli.js", ...args], { cwd: path.resolve("."), stdio: "pipe" });
  assert.throws(
    () => cli(["status", "--include-local"]),
    /--include-local requires --compile/
  );
  assert.throws(
    () => cli(["convert", "codex", "cc", "--compile", "--dry-run"]),
    /--compile is only supported/
  );
  assert.throws(
    () => cli(["convert", "cc", "codex", "--global", "--compile", "--dry-run"]),
    /--compile is only supported/
  );
});

test("rejects handoff-only options outside handoff", () => {
  const cli = (args) => execFileSync(process.execPath, ["src/cli.js", ...args], { cwd: path.resolve("."), stdio: "pipe" });
  assert.throws(
    () => cli(["status", "--stdout"]),
    /--stdout is only supported for handoff/
  );
  assert.throws(
    () => cli(["status", "--output", "HANDOFF.md"]),
    /--output is only supported for handoff/
  );
  assert.throws(
    () => cli(["handoff", "--stdout", "--output", "HANDOFF.md"]),
    /--output cannot be used with --stdout/
  );
});

test("labels existing copy-dir plans as merge", () => {
  const dir = fixture();
  const from = path.join(dir, ".claude", "skills");
  const to = path.join(dir, ".codex", "skills");
  mkdirSync(from, { recursive: true });
  mkdirSync(to, { recursive: true });

  assert.deepEqual(planLabel({ kind: "copy-dir", from, path: to }, dir), {
    action: "merge",
    label: ".claude/skills -> .codex/skills"
  });
});

test("converts Claude HTTP MCP servers to Codex url servers, flagging auth headers", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      linear: { type: "http", url: "https://mcp.linear.app/sse" },
      authed: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer x" } },
      local: { command: "node", args: ["server.js"] }
    }
  }));

  const changes = planCcToCodex(dir);
  const codexConfig = changes.find((change) => change.path?.endsWith(".codex/config.toml"));
  const report = changes.find((change) => change.path?.endsWith("ai-switch-report.md"));

  assert.match(codexConfig.content, /\[mcp_servers\."local"\]/);
  assert.match(codexConfig.content, /\[mcp_servers\."linear"\]/);
  assert.match(codexConfig.content, /url = "https:\/\/mcp\.linear\.app\/sse"/);
  assert.match(codexConfig.content, /url = "https:\/\/api\.example\.com\/mcp"/);
  // a plain http server migrates cleanly; one with auth headers is flagged for manual setup
  assert.doesNotMatch(report.content, /"linear" is an HTTP server/);
  assert.match(report.content, /"authed" is an HTTP server; its URL was migrated, but auth headers need manual setup/);
});

test("reports local absolute paths in Claude MCP settings", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      localPath: {
        command: "/Users/example/.local/bin/node",
        args: ["/Users/example/dev/server.js", "https://example.com/not-a-path"],
        env: { CONFIG: "/Users/example/.config/tool.json" }
      }
    }
  }));

  const changes = planCcToCodex(dir);
  const report = changes.find((change) => change.path?.endsWith("ai-switch-report.md"));
  const notice = changes.find((change) => change.kind === "manual-review" && change.label === "mcp: localPath");

  assert.match(report.content, /contains local absolute path values/);
  assert.match(report.content, /\/Users\/example\/dev\/server\.js/);
  assert.doesNotMatch(report.content, /https:\/\/example\.com\/not-a-path/);
  assert.match(notice.reason, /\/Users\/example\/.local\/bin\/node/);
});

test("reports local absolute paths in Codex MCP settings", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers."windowsPath"]
command = "C:\\\\Tools\\\\node.exe"
args = ["C:\\\\Users\\\\example\\\\server.js"]
`);

  const changes = planCodexToCc(dir);
  const report = changes.find((change) => change.path?.endsWith("ai-switch-report.md"));
  const notice = changes.find((change) => change.kind === "manual-review" && change.label === "mcp: windowsPath");

  assert.match(report.content, /contains local absolute path values/);
  assert.match(report.content, /C:\\Tools\\node\.exe/);
  assert.match(notice.reason, /C:\\Users\\example\\server\.js/);
});

test("skips duplicate Codex MCP names to avoid invalid TOML", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers."docs"]
command = "node"
args = ["existing.js"]
`);
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      docs: { command: "node", args: ["migrated.js"] },
      notes: { command: "node", args: ["notes.js"] }
    }
  }));

  const changes = planCcToCodex(dir);
  const codexConfig = changes.find((change) => change.path?.endsWith(".codex/config.toml"));
  const report = changes.find((change) => change.path?.endsWith("ai-switch-report.md"));

  assert.equal([...codexConfig.content.matchAll(/\[mcp_servers\."docs"\]/g)].length, 1);
  assert.match(codexConfig.content, /\[mcp_servers\."notes"\]/);
  assert.match(report.content, /"docs" was skipped because Codex config already has a server with that name/);
});

test("reports unsupported Codex MCP sections without command", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers."remote"]
url = "https://example.com/sse"

[mcp_servers."stdio"]
command = "node"
args = ["server.js"]
`);

  assert.deepEqual(analyzeCodexMcp(dir).servers, {
    remote: { url: "https://example.com/sse" },
    stdio: { command: "node", args: ["server.js"], env: undefined }
  });

  const changes = planCodexToCc(dir);
  const mcpJson = JSON.parse(changes.find((change) => change.path?.endsWith(".mcp.json")).content);

  // url servers now convert to Claude HTTP servers
  assert.deepEqual(mcpJson.mcpServers.remote, { type: "http", url: "https://example.com/sse" });
  assert.equal(mcpJson.mcpServers.stdio.command, "node");
});

test("reports Codex MCP sections with neither command nor url", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  writeFileSync(path.join(dir, ".codex", "config.toml"), `
[mcp_servers."broken"]
enabled = true
`);

  const report = planCodexToCc(dir).find((change) => change.path?.endsWith("ai-switch-report.md")).content;
  assert.match(report, /Codex MCP server "broken" was not converted because it has no stdio command or url/);
});

test("does not stack migration instruction headers", () => {
  const once = migrateInstruction("Review carefully.\n", "CLAUDE.md");
  const twice = migrateInstruction(once, "AGENTS.md");

  assert.equal([...twice.matchAll(/Migrated from/g)].length, 1);
  assert.match(twice, /Review carefully/);
});

test("global cc->codex migrates allowlisted files and references secret env", () => {
  const home = fixture();
  mkdirSync(path.join(home, ".claude", "skills", "review"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "Be concise.\n");
  writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({
    theme: "dark",
    mcpServers: { linear: { command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_API_KEY: "lin_SECRET" } } }
  }));
  writeFileSync(path.join(home, ".claude", "skills", "review", "SKILL.md"), "x\n");

  const changes = planCcToCodexGlobal(home, {});
  const config = changes.find((c) => c.path?.endsWith(".codex/config.toml")).content;
  assert.match(config, /\[mcp_servers\."linear"\]/);
  assert.match(config, /"LINEAR_API_KEY" = "\$LINEAR_API_KEY"/);
  assert.doesNotMatch(config, /lin_SECRET/);
  assert.ok(changes.some((c) => c.path?.endsWith(".codex/AGENTS.md")));
  assert.ok(changes.some((c) => c.kind === "copy-dir" && c.path?.endsWith(".agents/skills")));
});

test("global codex->cc merges into settings.json preserving other keys", async () => {
  const home = fixture();
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ theme: "dark", editorMode: "vim" }));
  writeFileSync(path.join(home, ".codex", "AGENTS.md"), "a\n");
  writeFileSync(path.join(home, ".codex", "config.toml"), '[mcp_servers.pg]\ncommand = "uvx"\nenv = { "DB" = "secret://x" }\n');

  await convertGlobal("codex", "cc", { home, env: {}, yes: true });
  const settings = JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.theme, "dark");
  assert.equal(settings.editorMode, "vim");
  assert.equal(settings.mcpServers.pg.command, "uvx");
  assert.equal(settings.mcpServers.pg.env.DB, "$DB");
});

test("global backup contains only allowlisted files, never auth/sessions", async () => {
  const home = fixture();
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  mkdirSync(path.join(home, ".codex", "sessions"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "x\n");
  writeFileSync(path.join(home, ".codex", "auth.json"), "AUTH");
  writeFileSync(path.join(home, ".codex", "sessions", "s.jsonl"), "S");

  const res = await convertGlobal("cc", "codex", { home, env: {}, yes: true });
  assert.ok(existsSync(path.join(res.backupDir, "claude", "CLAUDE.md")));
  assert.equal(existsSync(path.join(res.backupDir, "codex", "auth.json")), false);
  assert.equal(existsSync(path.join(res.backupDir, "codex", "sessions")), false);
  assert.equal(readFileSync(path.join(home, ".codex", "auth.json"), "utf8"), "AUTH");
});

test("global restore reverts a migration", async () => {
  const home = fixture();
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "orig\n");

  await convertGlobal("cc", "codex", { home, env: {}, yes: true });
  assert.ok(existsSync(path.join(home, ".codex", "AGENTS.md")));

  await restoreGlobalBackup(home, "latest", {});
  assert.equal(existsSync(path.join(home, ".codex", "AGENTS.md")), false);
  assert.equal(readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8"), "orig\n");
});

test("literalEnvNamesInConfigs flags literal env in existing target config, not just converted servers", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "config.toml"), '[mcp_servers.legacy]\ncommand = "old"\nenv = { "OLD_TOKEN" = "tok_REAL", "REF" = "$REF" }\n');
  const names = literalEnvNamesInConfigs([{ path: path.join(dir, "config.toml"), format: "toml" }]);
  assert.deepEqual(names, ["OLD_TOKEN"]);
});

test("codex->cc reads skills from .agents/skills (newer location), not just .codex/skills", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".agents", "skills", "fmt"), { recursive: true });
  writeFileSync(path.join(dir, ".agents", "skills", "fmt", "SKILL.md"), "x\n");

  const changes = planCodexToCc(dir);
  assert.ok(changes.some((c) =>
    c.kind === "copy-dir" && c.from.endsWith(".agents/skills") && c.path.endsWith(".claude/skills")));
});

test("cc->codex writes skills to .agents/skills (preferred Codex location)", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "skills", "review"), { recursive: true });
  writeFileSync(path.join(dir, ".claude", "skills", "review", "SKILL.md"), "x\n");

  const changes = planCcToCodex(dir);
  assert.ok(changes.some((c) =>
    c.kind === "copy-dir" && c.from.endsWith(".claude/skills") && c.path.endsWith(".agents/skills")));
  assert.ok(!changes.some((c) => c.path?.endsWith(".codex/skills")));
});

test("HTTP MCP round-trips: cc http url -> codex url -> cc http", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: { gw: { type: "http", url: "https://x.example/mcp" } }
  }));
  const codexConfig = planCcToCodex(dir).find((c) => c.path?.endsWith(".codex/config.toml")).content;
  assert.match(codexConfig, /\[mcp_servers\."gw"\]/);
  assert.match(codexConfig, /url = "https:\/\/x\.example\/mcp"/);

  const dir2 = fixture();
  mkdirSync(path.join(dir2, ".codex"), { recursive: true });
  writeFileSync(path.join(dir2, ".codex", "config.toml"), codexConfig);
  const mcpJson = JSON.parse(planCodexToCc(dir2).find((c) => c.path?.endsWith(".mcp.json")).content);
  assert.deepEqual(mcpJson.mcpServers.gw, { type: "http", url: "https://x.example/mcp" });
});

test("restore cleanly removes merged .claude/skills (two source skill dirs)", async () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex", "skills", "a"), { recursive: true });
  mkdirSync(path.join(dir, ".agents", "skills", "b"), { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), "a\n");
  writeFileSync(path.join(dir, ".codex", "skills", "a", "SKILL.md"), "a\n");
  writeFileSync(path.join(dir, ".agents", "skills", "b", "SKILL.md"), "b\n");

  await convert("codex", "cc", { cwd: dir, yes: true });
  assert.ok(existsSync(path.join(dir, ".claude", "skills", "a")));
  assert.ok(existsSync(path.join(dir, ".claude", "skills", "b")));

  // restore must not mistake the merge for a user edit (no --force needed)
  await restoreBackup(dir, "latest");
  assert.equal(existsSync(path.join(dir, ".claude", "skills")), false);
});

test("project backup includes .agents so cc->codex --force is recoverable", async () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "skills", "new"), { recursive: true });
  mkdirSync(path.join(dir, ".agents", "skills", "orig"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "p\n");
  writeFileSync(path.join(dir, ".claude", "skills", "new", "SKILL.md"), "new\n");
  writeFileSync(path.join(dir, ".agents", "skills", "orig", "SKILL.md"), "ORIGINAL\n");

  const result = await convert("cc", "codex", { cwd: dir, yes: true, force: true });
  assert.ok(existsSync(path.join(result.backupDir, ".agents", "skills", "orig", "SKILL.md")));

  await restoreBackup(dir, "latest", { force: true });
  assert.equal(readFileSync(path.join(dir, ".agents", "skills", "orig", "SKILL.md"), "utf8"), "ORIGINAL\n");
});

test("audit classifies Claude surfaces as migrated / manual / unsupported", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "skills", "s"), { recursive: true });
  mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  mkdirSync(path.join(dir, ".claude", "output-styles"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "p\n");
  writeFileSync(path.join(dir, "CLAUDE.local.md"), "local\n");
  writeFileSync(path.join(dir, ".claude", "agents", "rev.md"), "a\n");
  writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ mcpServers: {}, hooks: {}, permissions: {} }));

  const byStatus = (status) => auditSurfaces(dir).filter((s) => s.status === status).map((s) => s.surface);
  assert.ok(byStatus("migrated").includes("CLAUDE.md"));
  assert.ok(byStatus("manual").includes("CLAUDE.local.md"));
  assert.ok(byStatus("manual").includes(".claude/agents"));
  assert.ok(byStatus("manual").includes(".claude/settings.json"));
  assert.ok(byStatus("unsupported").includes(".claude/output-styles"));
});

test("audit gaps appear in the migration report", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "p\n");
  writeFileSync(path.join(dir, ".claude", "agents", "rev.md"), "a\n");

  const report = planCcToCodex(dir).find((c) => c.path?.endsWith("ai-switch-report.md")).content;
  assert.match(report, /## Other Claude surfaces detected/);
  assert.match(report, /\.claude\/agents \(manual\)/);
});

test("compile report does not flag compiled instruction hierarchy as a gap", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "rules"), { recursive: true });
  mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n");
  writeFileSync(path.join(dir, ".claude", "CLAUDE.md"), "Nested.\n");
  writeFileSync(path.join(dir, ".claude", "rules", "style.md"), "Style.\n");
  writeFileSync(path.join(dir, "CLAUDE.local.md"), "Local.\n");
  writeFileSync(path.join(dir, ".claude", "agents", "review.md"), "Agent.\n");

  const report = planCcToCodex(dir, { compile: true }).find((c) => c.path?.endsWith("ai-switch-report.md")).content;
  assert.doesNotMatch(report, /\.claude\/CLAUDE.md \(manual\)/);
  assert.doesNotMatch(report, /\.claude\/rules \(manual\)/);
  assert.match(report, /CLAUDE.local.md \(manual\)/);
  assert.match(report, /\.claude\/agents \(manual\)/);
});

test("compile includeLocal report does not flag CLAUDE.local.md as a gap", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n");
  writeFileSync(path.join(dir, "CLAUDE.local.md"), "Local.\n");

  const report = planCcToCodex(dir, { compile: true, includeLocal: true }).find((c) => c.path?.endsWith("ai-switch-report.md")).content;
  assert.doesNotMatch(report, /CLAUDE.local.md \(manual\)/);
  assert.doesNotMatch(report, /Other Claude surfaces detected/);
});

test("Claude sse url servers are not auto-converted (only http)", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      streamy: { type: "sse", url: "https://x/sse" },
      webby: { type: "http", url: "https://y/mcp" }
    }
  }));
  const changes = planCcToCodex(dir);
  const config = changes.find((c) => c.path?.endsWith(".codex/config.toml")).content;
  const report = changes.find((c) => c.path?.endsWith("ai-switch-report.md")).content;
  assert.doesNotMatch(config, /streamy/);
  assert.match(config, /\[mcp_servers\."webby"\]/);
  assert.match(report, /"streamy" uses the "sse" transport/);
});

test("audit counts only actually-converted MCP servers as migrated", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      ok: { command: "node", args: ["s.js"] },
      streamy: { type: "sse", url: "https://x/sse" }
    }
  }));
  const surfaces = auditSurfaces(dir);
  const migrated = surfaces.find((s) => s.surface === "MCP servers");
  const manual = surfaces.find((s) => s.surface === "MCP servers (need manual attention)");
  assert.match(migrated.detail, /^1 server/);
  assert.ok(manual && manual.status === "manual");
  assert.match(manual.detail, /streamy/);
});

test("audit flags http MCP auth as manual even though its url is migrated", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      authed: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer x" } }
    }
  }));
  const surfaces = auditSurfaces(dir);
  assert.ok(surfaces.some((s) => s.surface === "MCP servers" && s.status === "migrated"));
  const manual = surfaces.find((s) => s.surface === "MCP servers (need manual attention)");
  assert.ok(manual && manual.detail.includes("authed"));
});

test("audit detects .claude/settings.local.json as a private surface", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  writeFileSync(path.join(dir, ".claude", "settings.local.json"), JSON.stringify({ hooks: {} }));
  assert.ok(auditSurfaces(dir).some((s) => s.surface === ".claude/settings.local.json" && s.status === "manual"));
});

test("codex->cc report has no Claude-surface gap section", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".codex"), { recursive: true });
  mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), "a\n");
  writeFileSync(path.join(dir, ".claude", "agents", "x.md"), "x\n");
  writeFileSync(path.join(dir, ".codex", "config.toml"), '[mcp_servers.x]\ncommand = "c"\n');

  const report = planCodexToCc(dir).find((c) => c.path?.endsWith("ai-switch-report.md")).content;
  assert.doesNotMatch(report, /Other Claude surfaces detected/);
});

test("audit follows valid symlink dirs but skips broken ones without crashing", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  mkdirSync(path.join(dir, "real-agents", "sub"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "p\n");
  symlinkSync(path.join(dir, "real-agents", "sub"), path.join(dir, ".claude", "agents", "shared")); // valid -> dir
  symlinkSync("/nonexistent/target", path.join(dir, ".claude", "agents", "broken")); // broken

  let surfaces;
  assert.doesNotThrow(() => { surfaces = auditSurfaces(dir); });
  assert.doesNotThrow(() => doctorReport(dir));
  // the valid symlinked directory is counted (Claude loads with --follow)
  assert.ok(surfaces.some((s) => s.surface === ".claude/agents"));
});

test("compile synthesizes the instruction hierarchy with source labels", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n");
  writeFileSync(path.join(dir, ".claude", "CLAUDE.md"), "Nested.\n");
  writeFileSync(path.join(dir, ".claude", "rules", "style.md"), "Style.\n");

  const { content } = compileInstructions(dir, {});
  assert.match(content, /## From CLAUDE.md/);
  assert.match(content, /## From \.claude\/CLAUDE.md/);
  assert.match(content, /## From \.claude\/rules\/style.md/);
  assert.match(content, /Root\.[\s\S]*Nested\.[\s\S]*Style\./);
});

test("compile inlines a safe @include with a source marker", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n@docs/extra.md\n");
  writeFileSync(path.join(dir, "docs", "extra.md"), "Extra.\n");

  const { content, manualReviews } = compileInstructions(dir, {});
  assert.match(content, /<!-- included from docs\/extra.md via CLAUDE.md -->/);
  assert.match(content, /Extra\./);
  assert.equal(manualReviews.length, 0);
});

test("compile excludes CLAUDE.local.md unless includeLocal", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n");
  writeFileSync(path.join(dir, "CLAUDE.local.md"), "PRIVATE.\n");
  assert.doesNotMatch(compileInstructions(dir, {}).content, /PRIVATE/);
  assert.match(compileInstructions(dir, { includeLocal: true }).content, /PRIVATE/);
});

test("compile reports unsafe @include and keeps the original line", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n@/etc/passwd\n@missing.md\n");
  const { content, manualReviews } = compileInstructions(dir, {});
  assert.match(content, /@\/etc\/passwd/);
  assert.match(content, /@missing.md/);
  assert.match(manualReviews.join("\n"), /absolute or home paths/);
  assert.match(manualReviews.join("\n"), /file not found/);
});

test("compile does not inline includes outside the project", () => {
  const dir = fixture();
  const outside = fixture();
  writeFileSync(path.join(outside, "secret.md"), "SECRET.\n");
  writeFileSync(path.join(dir, "CLAUDE.md"), `@../${path.basename(outside)}/secret.md\n`);
  const { content, manualReviews } = compileInstructions(dir, {});
  assert.doesNotMatch(content, /SECRET/);
  assert.match(manualReviews.join("\n"), /escapes the project directory/);
});

test("compile ignores @include-looking lines inside fenced code blocks", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "```md\n@docs/extra.md\n```\n");
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "extra.md"), "Extra.\n");
  const { content, manualReviews } = compileInstructions(dir, {});
  assert.match(content, /@docs\/extra.md/);
  assert.doesNotMatch(content, /Extra\./);
  assert.equal(manualReviews.length, 0);
});

test("compile detects circular includes", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, "CLAUDE.md"), "@a.md\n");
  writeFileSync(path.join(dir, "a.md"), "A\n@b.md\n");
  writeFileSync(path.join(dir, "b.md"), "B\n@a.md\n");
  const { manualReviews } = compileInstructions(dir, {});
  assert.match(manualReviews.join("\n"), /circular include/);
});

test("default convert (no --compile) migrates only root CLAUDE.md", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n");
  writeFileSync(path.join(dir, ".claude", "rules", "style.md"), "Style.\n");
  const agents = planCcToCodex(dir).find((c) => c.path?.endsWith("AGENTS.md")).content;
  assert.match(agents, /Migrated from CLAUDE.md/);
  assert.doesNotMatch(agents, /Style\./);
});

test("compile convert mode writes the synthesized AGENTS.md", () => {
  const dir = fixture();
  mkdirSync(path.join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(path.join(dir, "CLAUDE.md"), "Root.\n");
  writeFileSync(path.join(dir, ".claude", "rules", "style.md"), "Style.\n");
  const agents = planCcToCodex(dir, { compile: true }).find((c) => c.path?.endsWith("AGENTS.md")).content;
  assert.match(agents, /Compiled from Claude Code/);
  assert.match(agents, /## From \.claude\/rules\/style.md/);
});

test("handoff generates a scaffold without git", () => {
  const dir = fixture();
  const content = generateHandoff(dir, { generatedAt: "2026-01-02T03:04:05.000Z" });
  assert.match(content, /^# AI Handoff\n/);
  assert.match(content, /without reading raw chat, sessions, or file contents/);
  assert.match(content, new RegExp(`project: \`${path.basename(dir)}`));
  assert.equal(content.includes(dir), false);
  assert.match(content, /branch: _not available_/);
  assert.match(content, /Git status not available/);
  assert.match(content, /## Goal[\s\S]*_Fill in the current objective\._/);
});

test("handoff writes CODEX-HANDOFF.md and protects existing files", async () => {
  const dir = fixture();
  const result = await handoff(dir, { generatedAt: "2026-01-02T03:04:05.000Z" });
  assert.equal(path.basename(result.path), "CODEX-HANDOFF.md");
  assert.ok(existsSync(path.join(dir, "CODEX-HANDOFF.md")));

  await assert.rejects(
    () => handoff(dir, {}),
    /Refusing to overwrite existing handoff without --force/
  );
  await assert.rejects(
    () => handoff(dir, { output: "../HANDOFF.md" }),
    /must stay inside the project directory/
  );
  await assert.rejects(
    () => handoff(dir, { output: "AGENTS.md" }),
    /Refusing to write handoff into AGENTS.md/
  );

  await handoff(dir, { force: true });
});

test("handoff refuses output through a symlinked parent directory", async () => {
  const dir = fixture();
  const outside = fixture();
  symlinkSync(outside, path.join(dir, "docs"));

  await assert.rejects(
    () => handoff(dir, { output: "docs/HANDOFF.md" }),
    /output parent resolves outside the project directory/
  );
  assert.equal(existsSync(path.join(outside, "HANDOFF.md")), false);
});

test("handoff fills git-derived branch, changed files, and recent commits", () => {
  if (!hasGit()) return;
  const dir = fixture();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  writeFileSync(path.join(dir, "README.md"), "initial\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "initial commit"]);
  git(dir, ["checkout", "-b", "handoff-test"]);

  writeFileSync(path.join(dir, "README.md"), "changed\n");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "new.js"), "console.log('new');\n");

  const content = generateHandoff(dir, { generatedAt: "2026-01-02T03:04:05.000Z" });
  assert.match(content, /branch: `handoff-test`/);
  assert.match(content, /README.md/);
  assert.match(content, /src\/new.js/);
  assert.match(content, /initial commit/);
  assert.match(content, /## Diff Summary[\s\S]*README.md/);
});

test("handoff --stdout does not write a file", () => {
  const dir = fixture();
  const output = execFileSync(process.execPath, ["src/cli.js", "handoff", "--cwd", dir, "--stdout"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });
  assert.match(output, /^# AI Handoff\n/);
  assert.equal(existsSync(path.join(dir, "CODEX-HANDOFF.md")), false);
});

test("handoff title is direction-agnostic; --from/--to annotate context", () => {
  const dir = fixture();
  const plain = generateHandoff(dir, {});
  assert.match(plain, /^# AI Handoff\n/);
  assert.doesNotMatch(plain, /AI Handoff \(/);

  const annotated = generateHandoff(dir, { handoffFrom: "codex", handoffTo: "cc" });
  assert.match(annotated, /- from: Codex/);
  assert.match(annotated, /- to: Claude Code/);
});
