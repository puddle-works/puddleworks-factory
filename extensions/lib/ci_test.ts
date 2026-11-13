/**
 * Tests for reading a job's inputs from an app's ci.yml.
 *
 * Run with:
 *   $(swamp doctor extensions --json | jq -r .denoPath) test extensions/lib/ci_test.ts
 *
 * @module
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { ciInput } from "./ci.ts";

const ci = (publishWith: string) =>
  `jobs:
  tests:
    runs-on: ubuntu-24.04
    steps:
      - run: deno test --allow-net extensions/models/
  publish:
    uses: puddle-works/puddle-tooling/.github/workflows/publish.yml@v0.2.3
    with:
      visibility: private # must equal visibility: in manifest.yaml
${publishWith}
      dry-run: true
`;

Deno.test("ciInput: the value the publish job gives, not a line that looks like it", () => {
  // A job named like the input, above the job that gives it.
  assertEquals(
    ciInput(
      ci("      tests: deno test -R extensions/models/ # as CI"),
      "tests",
    ),
    "deno test -R extensions/models/",
  );
  assertEquals(
    ciInput(ci('      tests: "deno test --allow-write"'), "tests"),
    "deno test --allow-write",
  );
  assertEquals(
    ciInput(
      ci(
        "      tests: >-\n        deno test --allow-read\n        --allow-run=git",
      ),
      "tests",
    ),
    "deno test --allow-read --allow-run=git",
  );
});

Deno.test("ciInput: no value is empty, never the next line", () => {
  assertEquals(
    ciInput(ci("      accepted-warnings:"), "accepted-warnings"),
    "",
  );
  assertEquals(
    ciInput(
      ci("      accepted-warnings:\n        - deno-command"),
      "accepted-warnings",
    ),
    "",
  );
  assertEquals(ciInput(ci("      tests: deno test"), "accepted-warnings"), "");
  assertEquals(ciInput("jobs: [", "tests"), "");
  assertEquals(ciInput("on: push\n", "tests"), "");
  assertEquals(ciInput(null, "tests"), "");
});
