import path from "node:path";

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

export {
  GLOBAL_RELATIVE_PATHS,
  RELATIVE_PATHS,
  codexSkillSources,
  globalAllowlist,
  globalPathsFor,
  projectPaths
};
