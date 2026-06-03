import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCodexMcp,
  analyzeClaudeMcpSources,
  convert,
  detect,
  detectGlobal,
  doctorReport,
  extractCodexMcp,
  listBackups,
  migrateInstruction,
  parseArgs,
  planLabel,
  planCcToCodex,
  planCodexToCc,
  restoreBackup,
  status
} from "../src/cli.js";

function fixture() {
  return mkdtempSync(path.join(tmpdir(), "ai-switch-"));
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
    ".codex/skills",
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

  const report = planCcToCodex(dir).find((change) => change.path?.endsWith("ai-switch-report.md")).content;
  assert.match(report, /## Credentials needed/);
  assert.match(report, /LINEAR_API_KEY \(server: linear\) — referenced via env/);
  assert.match(report, /GITHUB_TOKEN \(server: github\) — a literal value is present \(redacted\)/);
  assert.doesNotMatch(report, /ghp_REALsecret123/);
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

test("refuses project writes in the home directory", async () => {
  await assert.rejects(
    () => convert("codex", "cc", { cwd: homedir(), yes: true }),
    /Refusing project migration in your home directory/
  );
});

test("allows read-only dry-run preview in the home directory", async () => {
  const result = await convert("codex", "cc", { cwd: homedir(), dryRun: true });
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

test("rejects unknown options", () => {
  assert.throws(
    () => parseArgs(["convert", "cc", "codex", "--frce"]),
    /Unknown option: --frce/
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

test("reports unsupported Claude HTTP MCP servers instead of writing empty Codex sections", () => {
  const dir = fixture();
  writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({
    mcpServers: {
      linear: { type: "http", url: "https://mcp.linear.app/sse" },
      local: { command: "node", args: ["server.js"] }
    }
  }));

  const changes = planCcToCodex(dir);
  const codexConfig = changes.find((change) => change.path?.endsWith(".codex/config.toml"));
  const report = changes.find((change) => change.path?.endsWith("ai-switch-report.md"));

  assert.match(codexConfig.content, /\[mcp_servers\."local"\]/);
  assert.doesNotMatch(codexConfig.content, /\[mcp_servers\."linear"\]/);
  assert.match(report.content, /Claude MCP server "linear" needs manual migration/);
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
    stdio: { command: "node", args: ["server.js"], env: undefined }
  });

  const changes = planCodexToCc(dir);
  const mcpJson = JSON.parse(changes.find((change) => change.path?.endsWith(".mcp.json")).content);
  const report = changes.find((change) => change.path?.endsWith("ai-switch-report.md"));

  assert.equal(mcpJson.mcpServers.remote, undefined);
  assert.match(report.content, /Codex MCP server "remote" was not converted/);
});

test("does not stack migration instruction headers", () => {
  const once = migrateInstruction("Review carefully.\n", "CLAUDE.md");
  const twice = migrateInstruction(once, "AGENTS.md");

  assert.equal([...twice.matchAll(/Migrated from/g)].length, 1);
  assert.match(twice, /Review carefully/);
});
