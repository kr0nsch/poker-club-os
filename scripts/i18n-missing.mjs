// Lists UI strings passed to t("…") that have no Russian translation.
//   node scripts/i18n-missing.mjs [path-prefix …]     e.g. src/components/floor src/app/dealer
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web");
const dictDir = path.join(root, "src/lib/i18n");

const dict = new Set();
for (const f of readdirSync(dictDir)) {
  const src = readFileSync(path.join(dictDir, f), "utf8");
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0) continue;
  const obj = new Function(`return (${src.slice(start, end + 1)})`)();
  for (const k of Object.keys(obj)) dict.add(k);
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(f)) out.push(p);
  }
  return out;
}

const prefixes = process.argv.slice(2).map((p) => path.join(root, p));
const files = walk(path.join(root, "src")).filter((f) => !f.startsWith(dictDir) && (prefixes.length === 0 || prefixes.some((p) => f.startsWith(p))));
const re = /\bt\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
const missing = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    if (m[1] === "`" && m[2].includes("${")) continue;
    const key = m[2].replace(/\\(["'`\\])/g, "$1");
    if (!dict.has(key)) {
      const rel = path.relative(root, f).replaceAll("\\", "/");
      if (!missing.has(key)) missing.set(key, rel);
    }
  }
}
for (const [k, f] of [...missing.entries()].sort((a, b) => a[1].localeCompare(b[1]))) console.log(`${JSON.stringify(k)}\t${f}`);
console.error(`${missing.size} missing translation(s) in ${files.length} file(s)`);
