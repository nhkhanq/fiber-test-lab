// Emits the declarations a consuming project type-checks against. The library itself runs from
// source through tsx; this is the only generated output, and nothing at runtime depends on it.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "types");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.types.json")], { cwd: root, stdio: "inherit" });

// The sources use extensionless relative imports, which NodeNext refuses in ESM declarations: the
// import silently becomes `any`. Spell out what each one resolves to.
function withExtension(file, specifier) {
  const target = resolve(dirname(file), specifier);
  if (existsSync(`${target}.d.ts`)) return `${specifier}.js`;
  if (existsSync(join(target, "index.d.ts"))) return `${specifier}/index.js`;
  return specifier;
}

function rewrite(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewrite(path);
    } else if (entry.name.endsWith(".d.ts")) {
      const source = readFileSync(path, "utf8");
      const fixed = source.replace(
        /(\bfrom\s+|\bimport\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g,
        (_, prefix, quote, specifier) => `${prefix}${quote}${withExtension(path, specifier)}${quote}`,
      );
      if (fixed !== source) writeFileSync(path, fixed);
    }
  }
}

rewrite(out);
