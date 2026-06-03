import { existsSync } from "node:fs";
import { readJson, readText } from "./io.js";
import { globalPathsFor, projectPaths } from "./paths.js";
import { escapeToml, extractTomlRawValue, parseTomlHeaderPath, parseTomlKeyValueBlock, parseTomlValue } from "./toml.js";

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
    if (!raw.has(name)) {
      raw.set(name, { command: undefined, args: undefined, env: undefined, url: undefined, hasAuth: false, unsupported: [] });
      order.push(name);
    }
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
      // Codex's url transport is HTTP (StreamableHttp). Only auto-convert http
      // (or untyped) url servers; sse/ws/other transports differ and stay manual.
      if (server.type !== undefined && server.type !== "http") {
        manualReviews.push(`Claude MCP server "${name}" uses the "${server.type}" transport; only "http" (or untyped) url servers are auto-converted to Codex. Migrate it manually.`);
        planItems.push({
          kind: "manual-review",
          label: `mcp: ${name}`,
          reason: `Transport "${server.type}" is not auto-converted; only http url servers are.`
        });
        continue;
      }
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

export {
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
};
