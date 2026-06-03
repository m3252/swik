import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { copyFile, cp, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileChanges } from "./changes.js";
import { readJson } from "./io.js";
import { RELATIVE_PATHS, globalAllowlist, globalPathsFor, projectPaths } from "./paths.js";

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
    const expectedHash = expectedHashForChange(change);
    if (expectedHash) created[path.relative(cwd, change.path)] = expectedHash;
  }
  await writeFile(path.join(backupDir, ".ai-switch-manifest.json"), `${JSON.stringify({ createdAt: stamp, backedUp, planned, created }, null, 2)}\n`);
  return backupDir;
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
    } else {
      await copyFile(source, target);
    }
  }

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
    } else {
      await copyFile(source, entry.target);
    }
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

export {
  copyTree,
  hashPath,
  listBackups,
  listGlobalBackups,
  makeBackup,
  makeGlobalBackup,
  refreshCreatedHashes,
  restoreBackup,
  restoreGlobalBackup
};
