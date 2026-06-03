// Minimal dependency-free reader for the TOML value forms used by MCP configs:
// quoted strings, arrays of strings, and inline tables. Unlike a single-line
// regex, this handles multi-line values and quoted values with commas or "=".
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
      if (ch === "\"" || ch === "'") {
        i = scanTomlString(text, i) - 1;
        continue;
      }
      if (ch === "#") {
        const nl = text.indexOf("\n", i);
        if (nl === -1) return text.slice(start);
        i = nl;
        continue;
      }
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
    if (quote === "\"" && text[i] === "\\") {
      i += 1;
      continue;
    }
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
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
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
    if (ch === "#") {
      const nl = body.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

function topLevelEqualsIndex(pair) {
  let depth = 0;
  for (let i = 0; i < pair.length; i += 1) {
    const ch = pair[i];
    if (ch === "\"" || ch === "'") {
      i = scanTomlString(pair, i) - 1;
      continue;
    }
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

function escapeToml(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

export {
  escapeToml,
  extractTomlRawValue,
  parseTomlHeaderPath,
  parseTomlKeyValueBlock,
  parseTomlValue
};
