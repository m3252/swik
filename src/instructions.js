import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const COMPILE_ALLOWED_EXT = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml"]);
const COMPILE_MAX_FILE = 40 * 1024;
const COMPILE_MAX_TOTAL = 200 * 1024;

// --compile: synthesize Claude's instruction hierarchy into one AGENTS.md.
// Sources (in load order): CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md, and
// (only with includeLocal) CLAUDE.local.md. `@path` lines are inlined with a
// source marker; anything unsafe is left as-is and reported for manual review.
function compileInstructions(cwd, options = {}) {
  const root = realPathOrResolve(cwd);
  const sources = instructionSources(cwd, options);
  if (sources.length === 0) return { content: undefined, manualReviews: [], sources: [] };

  const ctx = { manualReviews: [], total: 0, root };
  const blocks = [];
  const compiledSources = [];
  for (const source of sources) {
    const raw = readSourceText(source, ctx);
    if (raw === undefined) continue;
    const chain = new Set([realPathOrResolve(source.file)]);
    const body = inlineIncludes(raw, source.file, source.label, chain, ctx).trim();
    blocks.push(`## From ${source.label}\n\n${body}`);
    compiledSources.push(source.label);
  }

  if (blocks.length === 0) return { content: undefined, manualReviews: ctx.manualReviews, sources: [] };
  const content = `# Project Instructions\n\nCompiled from Claude Code by ai-switch (--compile).\n\n${blocks.join("\n\n")}\n`;
  return { content, manualReviews: ctx.manualReviews, sources: compiledSources };
}

function instructionSources(cwd, options = {}) {
  const sources = [];
  const rootClaude = path.join(cwd, "CLAUDE.md");
  if (existsSync(rootClaude)) sources.push({ label: "CLAUDE.md", file: rootClaude });

  const nested = path.join(cwd, ".claude", "CLAUDE.md");
  if (existsSync(nested)) sources.push({ label: ".claude/CLAUDE.md", file: nested });

  const rulesDir = path.join(cwd, ".claude", "rules");
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir).sort()) {
      if (name.endsWith(".md")) sources.push({ label: `.claude/rules/${name}`, file: path.join(rulesDir, name) });
    }
  }

  const localFile = path.join(cwd, "CLAUDE.local.md");
  if (options.includeLocal && existsSync(localFile)) sources.push({ label: "CLAUDE.local.md", file: localFile });
  return sources;
}

function readSourceText(source, ctx) {
  try {
    const text = readFileSync(source.file, "utf8");
    ctx.total += Buffer.byteLength(text);
    if (ctx.total > COMPILE_MAX_TOTAL) {
      ctx.manualReviews.push(`Instruction source "${source.label}" pushed compiled output past ${COMPILE_MAX_TOTAL / 1024}KB. Review AGENTS.md size before use.`);
    }
    return text;
  } catch (error) {
    ctx.manualReviews.push(`Instruction source "${source.label}" could not be read: ${error.message}.`);
    return undefined;
  }
}

function inlineIncludes(content, baseFile, label, chain, ctx) {
  let fence = null;
  return content.split("\n").map((line) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;

    const match = line.match(/^\s*@(\S+)\s*$/);
    if (!match) return line;
    const ref = match[1];
    const verdict = readIncludeTarget(ref, baseFile, chain, ctx);
    if (verdict.error) {
      ctx.manualReviews.push(`@include "${ref}" (via ${label}) was not inlined: ${verdict.error}. Left the line in place — migrate it manually.`);
      return line;
    }
    ctx.total += verdict.size;
    chain.add(verdict.real);
    const inner = inlineIncludes(verdict.text, verdict.abs, ref, chain, ctx).trim();
    chain.delete(verdict.real);
    return `<!-- included from ${ref} via ${label} -->\n${inner}\n<!-- end include: ${ref} -->`;
  }).join("\n");
}

function readIncludeTarget(ref, baseFile, chain, ctx) {
  if (ref.startsWith("~") || path.isAbsolute(ref)) return { error: "absolute or home paths are not inlined" };

  const abs = path.resolve(path.dirname(baseFile), ref);
  let stats;
  let real;
  try {
    stats = statSync(abs);
    real = realpathSync(abs);
  } catch {
    return { error: "file not found" };
  }

  if (!isInsidePath(ctx.root, real)) return { error: "path escapes the project directory" };
  if (chain.has(real)) return { error: "circular include" };
  if (!stats.isFile()) return { error: "file not found" };
  if (!COMPILE_ALLOWED_EXT.has(path.extname(real).toLowerCase())) return { error: `unsupported file type (${path.extname(real) || "no extension"})` };
  if (stats.size > COMPILE_MAX_FILE) return { error: `file exceeds ${COMPILE_MAX_FILE / 1024}KB limit` };
  if (ctx.total + stats.size > COMPILE_MAX_TOTAL) return { error: "compiled output size limit reached" };

  try {
    return { abs, real, size: stats.size, text: readFileSync(abs, "utf8") };
  } catch (error) {
    return { error: `could not read file (${error.message})` };
  }
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realPathOrResolve(target) {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

export {
  compileInstructions
};
