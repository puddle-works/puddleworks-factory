/**
 * Tests for the build result contract, puddleworks.dev/build-result/v1.
 *
 * Run with:
 *   ~/.swamp/deno/deno test --allow-read extensions/contracts/build_result_v1_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { BUILD_RESULT_V1, parseBuildResult } from "./build_result_v1.ts";

const EXAMPLE = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../docs/contracts/build-result.v1.example.json",
      import.meta.url,
    ),
  ),
);

function problemsOf(value: unknown): string[] {
  const result = parseBuildResult(value);
  return result.ok ? [] : result.problems;
}

Deno.test("build-result: the documented example parses", () => {
  const result = parseBuildResult(EXAMPLE);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.result.apiVersion, BUILD_RESULT_V1);
    assertEquals(result.result.name, "obsidian-puddle-scanner");
  }
});

Deno.test("build-result: the pull request and path are optional", () => {
  const { pullRequest: _p, path: _q, ...rest } = EXAMPLE;
  assertEquals(problemsOf(rest), []);
});

Deno.test("build-result: another apiVersion is refused by name", () => {
  const problems = problemsOf({
    ...EXAMPLE,
    apiVersion: "puddleworks.dev/build-result/v2",
  });
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], BUILD_RESULT_V1);
});

Deno.test("build-result: the name must be a slug", () => {
  const problems = problemsOf({ ...EXAMPLE, name: "Obsidian Scanner" });
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "name");
});

Deno.test("build-result: links must be https", () => {
  const problems = problemsOf({
    ...EXAMPLE,
    repository: "http://github.com/example/my-apps",
    pullRequest: "git@github.com:example/my-apps.git",
  });
  assertEquals(problems.length, 2);
  assertStringIncludes(problems.join(" "), "repository");
  assertStringIncludes(problems.join(" "), "pullRequest");
});

Deno.test("build-result: the extension is a scoped package name", () => {
  const problems = problemsOf({ ...EXAMPLE, extension: "obsidian" });
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "extension");
});

Deno.test("build-result: the path stays inside the repository", () => {
  for (const path of ["/etc", "../elsewhere", "puddles/../../x"]) {
    const problems = problemsOf({ ...EXAMPLE, path });
    assertEquals(problems.length, 1, path);
    assertStringIncludes(problems[0], "path");
  }
});

Deno.test("build-result: builtAt is a timestamp", () => {
  const problems = problemsOf({ ...EXAMPLE, builtAt: "yesterday" });
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "builtAt");
});

Deno.test("build-result: a v1 reader ignores fields it does not know", () => {
  const result = parseBuildResult({ ...EXAMPLE, unknownField: "ignored" });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals("unknownField" in result.result, false);
});

Deno.test("build-result: the spec's source is optional, and kept when given", () => {
  const source = {
    url: "https://requests.example.com/8f0c6a52",
    version: 1,
    specHash: "3736f9d3",
  };
  const result = parseBuildResult({ ...EXAMPLE, source });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.result.source, source);
});

Deno.test("build-result: what was published is optional, and kept when given", () => {
  const published = { version: "2026.10.26.1", visibility: "private" };
  const result = parseBuildResult({ ...EXAMPLE, published });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.result.published, published);
});

Deno.test("build-result: published needs a version and a known visibility", () => {
  const problems = problemsOf({
    ...EXAMPLE,
    published: { version: "", visibility: "unlisted" },
  });
  assertEquals(problems.length, 2);
  assertStringIncludes(problems.join(" "), "published.version");
  assertStringIncludes(problems.join(" "), "published.visibility");
});

const EXAMPLES = [
  { phrase: "what needs reordering this week", passed: true },
  {
    phrase: "what should I reorder",
    passed: false,
    detail: "Answered for one week only.",
  },
];

Deno.test("build-result: the documented example reports its examples", () => {
  const result = parseBuildResult(EXAMPLE);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const examples = result.result.examples ?? [];
  assertEquals(examples.length > 0, true);
  assertEquals(examples.some((e) => e.passed), true);
  assertEquals(examples.some((e) => !e.passed && e.detail), true);
});

Deno.test("build-result: examples are optional, and kept when given", () => {
  const { examples: _e, ...rest } = EXAMPLE;
  const without = parseBuildResult(rest);
  assertEquals(without.ok, true);
  if (without.ok) assertEquals("examples" in without.result, false);
  const given = parseBuildResult({ ...EXAMPLE, examples: EXAMPLES });
  assertEquals(given.ok, true);
  if (given.ok) assertEquals(given.result.examples, EXAMPLES);
});

Deno.test("build-result: each example needs a phrase and whether it passed", () => {
  const problems = problemsOf({
    ...EXAMPLE,
    examples: [{ phrase: "   ", passed: true }, { phrase: "x", passed: "yes" }],
  });
  assertEquals(problems.length, 2);
  assertStringIncludes(problems.join(" "), "examples.0.phrase");
  assertStringIncludes(problems.join(" "), "examples.1.passed");
});

// The same bounds as the reader of these results, so nothing written here is
// refused there.
Deno.test("build-result: examples stay within their bounds", () => {
  const entry = (phrase: string, detail?: string) => ({
    phrase,
    passed: true,
    ...(detail === undefined ? {} : { detail }),
  });
  const within = {
    ...EXAMPLE,
    examples: [
      ...Array(49).fill(entry("x")),
      entry("y".repeat(500), "z".repeat(2_000)),
    ],
  };
  assertEquals(problemsOf(within), []);
  for (
    const [where, examples] of [
      ["examples", Array(51).fill(entry("x"))],
      ["examples.0.phrase", [entry("y".repeat(501))]],
      ["examples.0.detail", [entry("x", "z".repeat(2_001))]],
    ] as const
  ) {
    const problems = problemsOf({ ...EXAMPLE, examples });
    assertEquals(problems.length, 1, where);
    assertStringIncludes(problems[0], where);
  }
});

Deno.test("build-result: the contract doc names examples and what a missing one means", async () => {
  const doc = (await Deno.readTextFile(
    new URL("../../docs/contracts/build-result.md", import.meta.url),
  )).replace(/\s+/g, " ");
  for (
    const field of [
      "`examples`",
      "`examples[].phrase`",
      "`examples[].passed`",
      "`examples[].detail`",
    ]
  ) {
    assertStringIncludes(doc, field);
  }
  assertStringIncludes(doc, "A missing example counts as not passed");
});
