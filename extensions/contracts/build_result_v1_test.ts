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
