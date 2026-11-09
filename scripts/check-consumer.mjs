// Installs the packed library into an empty project and uses it the way another codebase would.
// Needs no Docker, so CI can run it on every operating system.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const root = mkdtempSync(join(tmpdir(), "fiber-lab-consumer-"));
const pack = join(root, "pack");
const project = join(root, "project");
mkdirSync(pack);
mkdirSync(join(project, "tests"), { recursive: true });

const failures = [];

function run(command, cwd = project) {
  return execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
}

function check(name, action) {
  try {
    action();
    console.log(`ok    ${name}`);
  } catch (error) {
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}` || error.message;
    failures.push(name);
    console.log(`FAIL  ${name}\n${detail.trim().split("\n").slice(-15).join("\n")}`);
  }
}

const write = (path, text) => writeFileSync(join(project, path), text);

run(`npm pack --pack-destination "${pack}"`, repo);
const tarball = join(pack, readdirSync(pack).find((f) => f.endsWith(".tgz")));

write("package.json", JSON.stringify({ name: "consumer", private: true, type: "module" }));
run(`npm install --no-audit --no-fund "${tarball}" vitest@2.1.9 typescript@5.9.3 @types/node@20`);

check("the binary runs", () => {
  const printed = run("npx fiber-lab --version").trim();
  if (printed !== version) throw new Error(`printed ${printed}, expected ${version}`);
});

check("the binary finds the built-in scenarios", () => {
  const { scenarios } = JSON.parse(run("npx fiber-lab list --json"));
  if (!scenarios.some((s) => s.name === "direct-channel" && s.valid)) throw new Error("direct-channel is missing or invalid");
});

check("a project config file is honoured", () => {
  write("fiber-lab.config.json", JSON.stringify({ pollTimeoutMs: "soon" }));
  try {
    run("npx fiber-lab test direct-channel");
    throw new Error("an invalid config was accepted");
  } catch (error) {
    if (error.status !== 1 || !String(error.stderr).includes("pollTimeoutMs")) throw error;
  } finally {
    rmSync(join(project, "fiber-lab.config.json"));
  }
});

write(
  "tests/import.test.ts",
  `import { expect, it } from "vitest";
import { setupScenario } from "fiber-test-lab/test-kit";
import { buildReportModel } from "fiber-test-lab/report";
it("imports", () => {
  expect(typeof setupScenario).toBe("function");
  expect(typeof buildReportModel).toBe("function");
});
`,
);
check("Vitest imports it with no configuration", () => run("npx vitest run tests/import.test.ts"));

write(
  "tests/plain.test.mjs",
  `import assert from "node:assert";
import { test } from "node:test";
import { setupScenario } from "fiber-test-lab/test-kit";
test("imports", () => assert.equal(typeof setupScenario, "function"));
`,
);
check("node:test imports it from plain JavaScript", () => run("node --test tests/plain.test.mjs"));

write(
  "tests/commonjs.cjs",
  `import("fiber-test-lab/test-kit").then((kit) => {
  if (typeof kit.setupScenario !== "function") process.exit(1);
});
`,
);
check("CommonJS reaches it through import()", () => run("node tests/commonjs.cjs"));

write(
  "tests/usage.ts",
  `import { setupScenario, expectBalance, type ScenarioContext, type PaymentOutcome } from "fiber-test-lab/test-kit";

export async function use(): Promise<PaymentOutcome> {
  const ctx: ScenarioContext = await setupScenario({ name: "typed", nodes: ["a", "b"] }, { config: { pollTimeoutMs: 1000 } });
  await expectBalance(ctx, { node: "a", local: 1 });
  return ctx.pay("a", "b", 1, { waitFor: "inflight" });
}

// @ts-expect-error a scenario is a name or an object. This fails if the types collapse to any.
export const wrong = setupScenario(1);
`,
);

const flags = {
  bundler: { module: "ESNext", moduleResolution: "Bundler" },
  nodenext: { module: "NodeNext", moduleResolution: "NodeNext" },
  strictest: {
    module: "ESNext",
    moduleResolution: "Bundler",
    exactOptionalPropertyTypes: true,
    noPropertyAccessFromIndexSignature: true,
    noUnusedLocals: true,
    verbatimModuleSyntax: true,
  },
};
for (const [name, options] of Object.entries(flags)) {
  write(
    `tsconfig.${name}.json`,
    JSON.stringify({
      compilerOptions: { target: "ES2022", strict: true, noEmit: true, skipLibCheck: true, types: ["node"], ...options },
      include: ["tests/usage.ts"],
    }),
  );
  check(`types work under ${name}`, () => run(`npx tsc -p tsconfig.${name}.json`));
}

rmSync(root, { recursive: true, force: true, maxRetries: 3 });
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
