// Parsing what swamp and deno report, for readiness's evidence (#50).
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parseJunit, parseQuality } from "./evidence.ts";

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
