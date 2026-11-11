// Parsing what swamp and deno report, for readiness's evidence (#50).
import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  parseJunit,
  parseQuality,
  realTests,
  testPermissions,
} from "./evidence.ts";
import type { SwampRun } from "./recipe_check.ts";

// Trimmed from `deno test --reporter=junit` with one failing test.
const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="deno test" tests="3" failures="1" errors="0" time="0.011">
    <testsuite name="./extensions/models/app_test.ts" tests="3" disabled="0" errors="0" failures="1">
        <testcase name="model type matches the app spec" classname="./extensions/models/app_test.ts" time="0.024" line="28" col="6">
            <failure message="Uncaught AssertionError: Values are not equal.">x</failure>
        </testcase>
        <testcase name="run handles &quot;quoted&quot; &amp; &lt;odd&gt; names" classname="./extensions/models/app_test.ts" time="0.000" line="32" col="6">
        </testcase>
        <testcase name="self closed" classname="x" time="0" line="1" col="1"/>
    </testsuite>
</testsuites>`;

Deno.test("parseJunit: a testcase with a failure did not pass, others did", () => {
  assertEquals(parseJunit(JUNIT), [
    { name: "model type matches the app spec", passed: false },
    { name: 'run handles "quoted" & <odd> names', passed: true },
    { name: "self closed", passed: true },
  ]);
});

Deno.test("parseQuality: reads the hash, points and what is missing", () => {
  const q = parseQuality(JSON.stringify({
    cacheHash: "9d7c".repeat(16),
    grade: "C",
    rubricVersion: 6,
    earnedPoints: 12,
    maxClientEarnablePoints: 14,
    gateFailures: [{ gate: "fmt-lint", message: "Extension has lint issues." }],
    factors: [
      { id: "has-readme", status: "missing" },
      { id: "dependency-trust", status: "partial" },
      { id: "repository-verified", status: "provisional" },
    ],
  }));
  assertEquals("error" in q ? q.error : q.missing, [
    "has-readme",
    "dependency-trust",
  ]);
  assertEquals("error" in q ? null : q.gateFailures, [
    "Extension has lint issues.",
  ]);
});

Deno.test("parseQuality: output with no content hash can't be used", () => {
  assertEquals("error" in parseQuality("{}"), true);
  assertEquals("error" in parseQuality("not json"), true);
});

// The app's CI test command, as render writes it into ci.yml (the
// publish job's `tests:` input), with the permissions the app's tests need.
const CI = `jobs:
  test:
    steps:
      - run: deno test --allow-read --allow-write --allow-run=git extensions/models/
  publish:
    with:
      visibility: private # must equal visibility: in manifest.yaml
      tests: deno test --allow-read --allow-write --allow-run=git extensions/models/ # as CI runs them
`;

Deno.test("testPermissions: the permission flags of ci.yml's tests command, nothing else", () => {
  assertEquals(testPermissions(CI), [
    "--allow-read",
    "--allow-write",
    "--allow-run=git",
  ]);
  assertEquals(
    testPermissions(
      "    with:\n      tests: deno test -A --reporter=dot --config x.json --deny-net=a.example extensions/models/\n",
    ),
    ["-A", "--deny-net=a.example"],
  );
  assertEquals(
    testPermissions("      tests: deno test extensions/models/\n"),
    [],
  );
  assertEquals(testPermissions("jobs: {}\n"), []);
  assertEquals(testPermissions(null), []);
});

Deno.test("realTests runs the app's tests with the permissions its ci.yml gives them", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/extensions/models`, { recursive: true });
    await Deno.mkdir(`${dir}/.github/workflows`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/extensions/models/app_test.ts`,
      `Deno.test("reads and writes a file", async () => {
  const f = await Deno.makeTempFile();
  await Deno.writeTextFile(f, "x");
  if (await Deno.readTextFile(f) !== "x") throw new Error("not read back");
  await Deno.remove(f);
});
`,
    );
    const swamp: SwampRun = () =>
      Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ denoPath: Deno.execPath() }),
        stderr: "",
      });
    // Without ci.yml the tests get no permissions, so this one fails.
    const bare = await realTests(swamp)(dir);
    assertEquals(bare.tests, [{
      name: "reads and writes a file",
      passed: false,
    }]);
    await Deno.writeTextFile(`${dir}/.github/workflows/ci.yml`, CI);
    const run = await realTests(swamp)(dir);
    assertEquals(run.tests, [{
      name: "reads and writes a file",
      passed: true,
    }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
