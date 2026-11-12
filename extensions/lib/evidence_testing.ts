/**
 * Test support: readiness's quality and test runs, faked so the model tests
 * run without swamp or a network.
 *
 * @module
 */
import type { SwampRun } from "./recipe_check.ts";
import type { TestRunner } from "./evidence.ts";
import { testNames } from "./readiness.ts";

/** The content hash the fake quality run reports. */
export const FAKE_HASH = "ab12".repeat(16);

/** The review report path push would name for `pkg` at FAKE_HASH. */
export const reviewPathFor = (pkg: string) =>
  `swamp-extension-review/${
    pkg.replaceAll("@", "_").replaceAll("/", "_")
  }-${FAKE_HASH}.json`;

/** A clean `swamp extension quality --json`, or undefined for other commands. */
export function fakeQuality(args: string[]) {
  if (args[0] !== "extension" || args[1] !== "quality") return undefined;
  return Promise.resolve({
    code: 0,
    stdout: JSON.stringify({
      cacheHash: FAKE_HASH,
      grade: "B",
      rubricVersion: 6,
      earnedPoints: 14,
      maxClientEarnablePoints: 14,
      gateFailures: [],
      factors: [{ id: "repository-verified", status: "provisional" }],
    }),
    stderr: "",
  });
}

/** swamp, answering only `extension quality`. */
export const fakeSwamp: SwampRun = (args) =>
  fakeQuality(args) ??
    Promise.resolve({ code: 1, stdout: "", stderr: `not faked: ${args}` });

/** Every test in the checkout's *_test.ts files ran and passed. */
export const passingTests: TestRunner = async (dir) => {
  const tests: Array<{ name: string; passed: boolean }> = [];
  const walk = async (d: string) => {
    for await (const e of Deno.readDir(d)) {
      if (e.isDirectory) await walk(`${d}/${e.name}`);
      else if (e.name.endsWith("_test.ts")) {
        for (
          const name of testNames(await Deno.readTextFile(`${d}/${e.name}`))
        ) {
          tests.push({ name, passed: true });
        }
      }
    }
  };
  await walk(`${dir}/extensions`).catch(() => {});
  return { tests };
};

/**
 * A reviewRounds record holding round 1 of `version` at FAKE_HASH, for
 * tests of readiness that are not about rounds.
 */
export const roundRecord = (name: string, pkg: string, version: string) => {
  const round = {
    version,
    kind: "review",
    round: 1,
    contentHash: FAKE_HASH,
    commit: "0123456789abcdef",
    file: reviewPathFor(pkg),
    base: null,
    changed: [],
    granted: false,
    carriedFrom: null,
    startedAt: "2026-11-11T12:00:00.000Z",
  };
  return {
    name,
    targetDir: "/",
    rounds: [round],
    latest: { ...round, skeleton: null, previous: null },
  };
};
