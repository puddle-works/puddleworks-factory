/**
 * Tests for the readiness check: whether a reviewed app is ready to publish,
 * and the one-screen summary the builder confirms against.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/readiness_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  assessReadiness,
  type ReadinessFacts,
  testNames,
} from "./readiness.ts";

const MANIFEST = `manifestVersion: 1
name: "@puddleworks/obsidian-puddle-scanner"
version: "2026.10.26.1"
repository: "https://github.com/puddle-works/obsidian-puddle-scanner"
license: MIT
visibility: private
models:
  - obsidian_puddle_scanner.ts
`;

const outcome = (version: number, ids: string[]) =>
  JSON.stringify({
    format: "puddleworks.dev/outcome-spec/v1",
    specification: {
      version,
      acceptanceCriteria: ids.map((id) => ({
        id,
        text: `Criterion ${id} holds`,
      })),
    },
  });

const TESTS = `import { assertEquals } from "jsr:@std/assert@1.0.19";
Deno.test("run: lists every open task", () => {});
Deno.test('run: skips done tasks', () => {});
Deno.test({ name: "run: reads only the vault", fn: () => {} });
Deno.test("run: handles \\"quoted\\" titles", async (t) => {
  await t.step("in a heading", () => {});
});
`;

const REVIEW_PATH =
  "swamp-extension-review/_puddleworks_obsidian-puddle-scanner-abc.json";

const review = (
  dimensions: Array<{ id: string; verdict: string; note?: string }> = [
    { id: "credentials-secrets", verdict: "pass" },
    { id: "api-contracts", verdict: "na" },
  ],
  over: Record<string, unknown> = {},
) => ({
  path: REVIEW_PATH,
  text: JSON.stringify({
    extension: "@puddleworks/obsidian-puddle-scanner",
    version: "2026.10.26.1",
    reviewedAt: "2026-10-26T16:00:00Z",
    dimensions,
    ...over,
  }),
});

const ACCEPTANCE = JSON.stringify({
  criteria: [
    { id: "AC1", tests: ["run: lists every open task"] },
    {
      id: "AC2",
      tests: ["run: skips done tasks", "in a heading"],
      manual: "",
    },
    { id: "AC3", tests: [], manual: "Ran the workflow on a real vault" },
  ],
});

/** A reviewed app that is ready: report complete, every criterion checked. */
function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    files: [
      { path: "manifest.yaml", text: MANIFEST },
      {
        path: "extensions/models/obsidian_puddle_scanner_test.ts",
        text: TESTS,
      },
      {
        path: "spec/outcome-spec.v1.json",
        text: outcome(1, ["AC1", "AC2"]),
      },
      {
        path: "spec/outcome-spec.v2.json",
        text: outcome(2, ["AC1", "AC2", "AC3"]),
      },
      { path: "spec/acceptance.json", text: ACCEPTANCE },
    ],
    review: review(),
    visibility: { recommendation: "private", canBePublic: true },
    pullRequest:
      "https://github.com/puddle-works/obsidian-puddle-scanner/pull/1",
    commit: "0123456789abcdef",
    ...overrides,
  };
}

const replace = (path: string, text: string | null) =>
  facts().files.flatMap((f) =>
    f.path !== path ? [f] : text === null ? [] : [{ path, text }]
  );

Deno.test("testNames: finds Deno.test and t.step names in every quote style", () => {
  assertEquals(testNames(TESTS), [
    "run: lists every open task",
    "run: skips done tasks",
    "run: reads only the vault",
    'run: handles "quoted" titles',
    "in a heading",
  ]);
});

Deno.test("readiness: a complete review with every criterion checked is ready", () => {
  const r = assessReadiness(facts());
  assertEquals(r.blockers, []);
  assertEquals(r.ready, true);
  assertEquals(r.package, "@puddleworks/obsidian-puddle-scanner");
  assertEquals(r.version, "2026.10.26.1");
  assertEquals(r.visibility, "private");
  assertEquals(r.recommendation, "private");
  assertEquals(r.review?.counts, { pass: 1, na: 1, issue: 0, pending: 0 });
  assertEquals(r.criteria.map((c) => [c.id, c.ok]), [
    ["AC1", true],
    ["AC2", true],
    ["AC3", true],
  ]);
  assertEquals(r.criteria[2].text, "Criterion AC3 holds");
});

Deno.test("readiness: the criteria come from the latest outcome spec version", () => {
  const r = assessReadiness(facts({
    files: facts().files.concat({
      path: "spec/outcome-spec.v10.json",
      text: outcome(10, ["AC1"]),
    }),
  }));
  assertEquals(r.criteria.map((c) => c.id), ["AC1"]);
  assertEquals(r.ready, false);
  assertStringIncludes(r.blockers.join("\n"), "AC2");
  assertStringIncludes(r.blockers.join("\n"), "spec/outcome-spec.v10.json");
});

Deno.test("readiness: a criterion with no test and no manual check blocks", () => {
  const r = assessReadiness(facts({
    files: replace(
      "spec/acceptance.json",
      JSON.stringify({
        criteria: [
          { id: "AC1", tests: ["run: lists every open task"] },
          { id: "AC2", tests: [], manual: "  " },
        ],
      }),
    ),
  }));
  assertEquals(r.ready, false);
  assertEquals(r.criteria.map((c) => [c.id, c.ok]), [
    ["AC1", true],
    ["AC2", false],
    ["AC3", false],
  ]);
  const text = r.blockers.join("\n");
  assertStringIncludes(text, "AC2 has no test and no manual check");
  assertStringIncludes(text, "AC3 is not in spec/acceptance.json");
});

Deno.test("readiness: a test name that no test file has blocks", () => {
  const r = assessReadiness(facts({
    files: replace(
      "spec/acceptance.json",
      ACCEPTANCE.replace("run: skips done tasks", "run: skips archived tasks"),
    ),
  }));
  assertEquals(r.ready, false);
  assertEquals(r.criteria[1].ok, false);
  assertStringIncludes(
    r.blockers.join("\n"),
    'AC2 names a test that is not in any *_test.ts: "run: skips archived tasks"',
  );
});

Deno.test("readiness: a mapped id that is not a criterion blocks", () => {
  const r = assessReadiness(facts({
    files: replace(
      "spec/acceptance.json",
      JSON.stringify({
        criteria: [
          ...JSON.parse(ACCEPTANCE).criteria,
          { id: "AC9", tests: ["run: lists every open task"] },
        ],
      }),
    ),
  }));
  assertEquals(r.ready, false);
  assertStringIncludes(r.blockers.join("\n"), "AC9");
});

Deno.test("readiness: criteria with no acceptance.json, or one that does not parse, block", () => {
  for (const text of [null, "{not json", '{"criteria": "AC1"}']) {
    const r = assessReadiness(facts({
      files: replace("spec/acceptance.json", text),
    }));
    assertEquals(r.ready, false, String(text));
    assertStringIncludes(r.blockers.join("\n"), "spec/acceptance.json");
  }
});

Deno.test("readiness: with no outcome spec there are no criteria to map", () => {
  const files = facts().files.filter((f) => !f.path.startsWith("spec/"));
  const r = assessReadiness(facts({ files }));
  assertEquals(r.criteria, []);
  assertEquals(r.ready, true, r.blockers.join("\n"));
  assertStringIncludes(r.summary, "no outcome spec");
});

Deno.test("readiness: a missing review report blocks", () => {
  const r = assessReadiness(facts({ review: null }));
  assertEquals(r.ready, false);
  assertEquals(r.review, null);
  assertStringIncludes(r.blockers.join("\n"), "review report");
});

Deno.test("readiness: a report for another name or version blocks", () => {
  for (
    const over of [
      { version: "2026.10.25.1" },
      { extension: "@puddleworks/other" },
    ]
  ) {
    const r = assessReadiness(facts({ review: review(undefined, over) }));
    assertEquals(r.ready, false, JSON.stringify(over));
    assertStringIncludes(r.blockers.join("\n"), "the manifest is");
  }
});

Deno.test("readiness: an issue or a pending verdict blocks, with its note", () => {
  const r = assessReadiness(facts({
    review: review([
      { id: "credentials-secrets", verdict: "pass" },
      { id: "error-handling", verdict: "issue", note: "run swallows a 404" },
      { id: "logging-quality", verdict: "pending" },
      { id: "api-contracts", verdict: "na" },
    ]),
  }));
  assertEquals(r.ready, false);
  assertEquals(r.review?.counts, { pass: 1, na: 1, issue: 1, pending: 1 });
  assertEquals(r.review?.issues, [
    { id: "error-handling", note: "run swallows a 404" },
  ]);
  const text = r.blockers.join("\n");
  assertStringIncludes(text, "error-handling: run swallows a 404");
  assertStringIncludes(text, "logging-quality");
});

Deno.test("readiness: a report with no reviewedAt date or no dimensions blocks", () => {
  for (
    const over of [
      { reviewedAt: "" },
      { reviewedAt: "<ISO-8601 timestamp>" },
      { dimensions: [] },
    ]
  ) {
    const r = assessReadiness(facts({ review: review(undefined, over) }));
    assertEquals(r.ready, false, JSON.stringify(over));
  }
});

Deno.test("readiness: no visibility check blocks", () => {
  const r = assessReadiness(facts({ visibility: null }));
  assertEquals(r.ready, false);
  assertStringIncludes(r.blockers.join("\n"), "visibility");
});

Deno.test("readiness: public when the required checks failed blocks", () => {
  const files = replace(
    "manifest.yaml",
    MANIFEST.replace("visibility: private", "visibility: public"),
  );
  const blocked = assessReadiness(facts({
    files,
    visibility: { recommendation: "private", canBePublic: false },
  }));
  assertEquals(blocked.ready, false);
  assertStringIncludes(blocked.blockers.join("\n"), "public");

  const chosen = assessReadiness(facts({
    files,
    visibility: { recommendation: "private", canBePublic: true },
  }));
  assertEquals(chosen.ready, true, chosen.blockers.join("\n"));
  assertStringIncludes(chosen.summary, "against a private recommendation");
});

Deno.test("readiness: no readable manifest blocks", () => {
  const r = assessReadiness(facts({ files: replace("manifest.yaml", ":\n") }));
  assertEquals(r.ready, false);
  assertEquals(r.package, null);
  assertStringIncludes(r.blockers.join("\n"), "manifest.yaml");
});

Deno.test("readiness: the summary fits one screen and says what is published", () => {
  const r = assessReadiness(facts());
  const lines = r.summary.split("\n");
  assertEquals(lines.length <= 24, true, r.summary);
  assertEquals(lines.every((l) => l.length <= 100), true, r.summary);
  for (
    const s of [
      "@puddleworks/obsidian-puddle-scanner 2026.10.26.1",
      "private (recommended: private)",
      "Ready to publish: yes",
      "https://github.com/puddle-works/obsidian-puddle-scanner/pull/1",
      "0123456",
      "1 pass, 1 n/a, 0 issue, 0 pending",
      "3 of 3 acceptance criteria checked",
      "AC3",
      "by hand: Ran the workflow on a real vault",
    ]
  ) assertStringIncludes(r.summary, s);
});

Deno.test("readiness: the summary lists blockers and caps a long list", () => {
  const many = Array.from({ length: 30 }, (_, i) => `AC${i + 1}`);
  const r = assessReadiness(facts({
    files: replace("spec/outcome-spec.v2.json", outcome(2, many)),
  }));
  assertEquals(r.ready, false);
  assertEquals(r.summary.split("\n").length <= 24, true, r.summary);
  assertStringIncludes(r.summary, "Ready to publish: no");
  assertStringIncludes(r.summary, "more");
});
