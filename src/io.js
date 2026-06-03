import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

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

export {
  listDir,
  readJson,
  readText
};
