/**
 * Tests for the review-round rules: what must be fixed before a round, the
 * limit of two per build, and a change that only bumps the version.
 *
 * Run with:
 *   $(swamp doctor extensions --json | jq -r .denoPath) test -A extensions/lib/rounds_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  acceptedWarnings,
  buildRounds,
  completeReportVersion,
  decideRound,
  onlyBumped,
  readDryRun,
  reportFile,
  type ReviewRound,
  roundCheck,
} from "./rounds.ts";
import { REVIEW_DIMENSIONS } from "./readiness.ts";

const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);
const H3 = "c3".repeat(32);
const H4 = "d4".repeat(32);

const dry = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    contentHash: H1,
    registryChecks: [{ name: "authentication", status: "passed" }],
    warnings: {
      review: [{
        ruleId: "adversarial-review-report",
        severity: "medium",
        skeleton: { extension: "@x/app", dimensions: [] },
      }],
      versionDrift: [{ check: "version-drift", output: "behind" }],
    },
    ...over,
  });

Deno.test("rounds: a dry run with only the review's warning lets a round start", () => {
  const r = readDryRun(dry());
  assertEquals(r.blockers, []);
  assertEquals(r.contentHash, H1);
  assertEquals(r.skeleton, { extension: "@x/app", dimensions: [] });
});

Deno.test("rounds: every other dry-run warning is fixed before round 1, unless the app accepts it", () => {
  const warnings = {
    review: [{ ruleId: "adversarial-review-report" }],
    safety: [{ ruleId: "deno-command", message: "Line 4 uses Deno.Command()" }],
    quality: [{ check: "version-bump-upgrade", output: "no upgrades array" }],
  };
  const r = readDryRun(dry({ warnings }));
  assertEquals(r.blockers, [
    "[deno-command] Line 4 uses Deno.Command()",
    "[version-bump-upgrade] no upgrades array",
  ]);
  assertEquals(
    readDryRun(dry({ warnings }), ["deno-command"]).blockers,
    ["[version-bump-upgrade] no upgrades array"],
  );
  // A dimension marked issue is the review's own finding, not the dry run's.
  assertEquals(
    readDryRun(dry({
      warnings: { review: [{ ruleId: "adversarial-review-dimension-issue" }] },
    })).blockers,
    [],
  );
});

Deno.test("rounds: a version that is already published is changed before round 1", () => {
  const r = readDryRun(dry({
    registryChecks: [{
      name: "version-exists",
      status: "failed",
      message: "Version 1.0 already exists for @x/app.",
    }, { name: "collective-membership", status: "failed", message: "no" }],
  }));
  assertEquals(r.blockers.length, 2);
  assertStringIncludes(r.blockers[0], "already exists");
  assertStringIncludes(r.blockers[0], "swamp extension version");
  assertStringIncludes(r.blockers[1], "collective-membership");
});

Deno.test("rounds: a dry run that isn't JSON or has no hash blocks", () => {
  assertEquals(readDryRun("Version exists").contentHash, null);
  assertEquals(readDryRun("Version exists").blockers.length, 1);
  assertStringIncludes(
    readDryRun(dry({ contentHash: "abc" })).blockers.join(),
    "no content hash",
  );
});

/** An app's ci.yml, with these lines among the publish job's inputs. */
const ciWith = (lines: string) =>
  `jobs:
  publish:
    with:
      visibility: private
${lines}
      dry-run: true
`;

Deno.test("rounds: accepted warnings come from ci.yml as publish.sh gets them", () => {
  assertEquals(
    acceptedWarnings(
      ciWith("      accepted-warnings: deno-command env-read # why"),
    ),
    ["deno-command", "env-read"],
  );
  assertEquals(
    acceptedWarnings(ciWith('      accepted-warnings: "deno-command"')),
    ["deno-command"],
  );
  assertEquals(
    acceptedWarnings(
      ciWith(
        "      accepted-warnings: >-\n        deno-command\n        env-read",
      ),
    ),
    ["deno-command", "env-read"],
  );
  // An empty value accepts nothing: the next line is another input.
  assertEquals(acceptedWarnings(ciWith("      accepted-warnings:")), []);
  assertEquals(acceptedWarnings(ciWith("      tests: deno test")), []);
  assertEquals(acceptedWarnings(null), []);
});

Deno.test("rounds: the report path is push's, sanitised the same way", () => {
  assertEquals(
    reportFile("@puddleworks/my-app", H1),
    `swamp-extension-review/_puddleworks_my-app-${H1}.json`,
  );
});

const round = (
  n: number,
  hash: string,
  over: Partial<ReviewRound> = {},
): ReviewRound => ({
  version: "1.0",
  kind: "review",
  round: n,
  contentHash: hash,
  commit: `commit-${n}-${hash.slice(0, 4)}`,
  file: reportFile("@x/app", hash),
  base: null,
  changed: [],
  granted: false,
  carriedFrom: null,
  startedAt: "2026-11-11T12:00:00.000Z",
  ...over,
});

const decide = (
  rounds: ReviewRound[],
  contentHash: string,
  over: { version?: string; published?: string | null; grant?: boolean } = {},
) =>
  decideRound({
    rounds,
    version: over.version ?? "1.0",
    contentHash,
    published: over.published ?? null,
    grant: over.grant ?? false,
  });

Deno.test("rounds: round 2 is the last without a yes, and builds on round 1", () => {
  assertEquals(decide([], H1), {
    kind: "start",
    round: 1,
    base: null,
    granted: false,
  });
  const one = round(1, H1);
  assertEquals(decide([one], H2), {
    kind: "start",
    round: 2,
    base: one,
    granted: false,
  });
  const third = decide([one, round(2, H2)], H3);
  assertEquals(third.kind, "blocked");
  if (third.kind === "blocked") {
    assertStringIncludes(third.message, "Round 3");
    assertStringIncludes(third.message, "grant=true");
  }
});

Deno.test("rounds: a yes covers one round past the limit, not the next", () => {
  const two = [round(1, H1), round(2, H2)];
  const third = decide(two, H3, { grant: true });
  assertEquals(third.kind === "start" && [third.round, third.granted], [
    3,
    true,
  ]);
  const three = [...two, round(3, H3, { granted: true })];
  assertEquals(decide(three, H4).kind, "blocked");
});

Deno.test("rounds: the same content again is that round, and costs none", () => {
  const two = [round(1, H1), round(2, H2)];
  assertEquals(decide(two, H2), { kind: "same", round: two[1] });
  assertEquals(decide(two, H1), { kind: "same", round: two[0] });
});

Deno.test("rounds: a new version mid-build keeps counting; a publish ends the build", () => {
  const two = [round(1, H1), round(2, H2)];
  // The version was taken, so the build moved to 1.1: still this build.
  assertEquals(decide(two, H3, { version: "1.1" }).kind, "blocked");
  // Same content under a new version is a new hash, but not a free round.
  assertEquals(
    decide(two, H2, { version: "1.1" }).kind,
    "blocked",
  );
  // 1.0 was published, so 1.1 is a new build with rounds of its own.
  const next = decide(two, H3, { version: "1.1", published: "1.0" });
  assertEquals(next.kind === "start" && next.round, 1);
  assertEquals(buildRounds(two, "1.0"), []);
  assertEquals(buildRounds(two, "0.9"), two);
});

Deno.test("rounds: after round 2, anything that ships is frozen", () => {
  const two = [round(1, H1), round(2, H2)];
  const frozen = roundCheck(two, "1.0", H3);
  assertStringIncludes(frozen.blocker!, "after round 2, which froze it");
  assertStringIncludes(frozen.blocker!, "`git diff commit-2-b2b`");
  const one = roundCheck([round(1, H1)], "1.0", H2);
  assertStringIncludes(one.blocker!, "No review round is recorded");
  assertEquals(roundCheck(two, "1.0", H2), {
    line: "round 2 of 2",
    round: two[1],
  });
  assertEquals(
    roundCheck(
      [round(0, H1, {
        kind: "carried",
        carriedFrom: { version: "0.9", contentHash: H4 },
      })],
      "1.0",
      H1,
    ).line,
    "carried from 0.9, since only the version changed",
  );
});

Deno.test("rounds: a report is complete only with pass or na on every dimension", () => {
  const report = (verdict: (id: string) => string, over = {}) =>
    JSON.stringify({
      extension: "@x/app",
      version: "1.0",
      dimensions: REVIEW_DIMENSIONS.map((id) => ({ id, verdict: verdict(id) })),
      ...over,
    });
  const ok = (id: string) => id === "lifetime-gc" ? "na" : "pass";
  assertEquals(
    completeReportVersion(report(ok), "@x/app", REVIEW_DIMENSIONS),
    "1.0",
  );
  for (
    const bad of [
      report((id) => id === "lifetime-gc" ? "issue" : "pass"),
      report((id) => id === "lifetime-gc" ? "pending" : "pass"),
      report(ok, { extension: "@x/other" }),
      JSON.stringify({ extension: "@x/app", version: "1.0", dimensions: [] }),
      "not json",
    ]
  ) assertEquals(completeReportVersion(bad, "@x/app", REVIEW_DIMENSIONS), null);
});

const MODEL = (version: string, upgrades: string) =>
  `export const model = {
  type: "@x/app",
  version: "${version}",
  upgrades: [
    {
      toVersion: "1.0",
      description: "First.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },${upgrades}
  ],
  methods: {},
};
`;

const NOOP = `
    {
      toVersion: "1.1",
      description: "No change to " +
        "the data.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },`;

Deno.test("rounds: the manifest's version line alone is a bump", () => {
  const before = 'name: "@x/app"\nversion: "1.0"\nmodels:\n  - app.ts\n';
  const after = before.replace('"1.0"', '"1.1"');
  assertEquals(onlyBumped(before, after, "1.0", "1.1"), true);
  assertEquals(
    onlyBumped(before, after.replace("app.ts", "other.ts"), "1.0", "1.1"),
    false,
  );
  assertEquals(onlyBumped(before, before, "1.0", "1.0"), false);
  // Bumped to a version other than the one the manifest now names.
  assertEquals(onlyBumped(before, after, "1.0", "1.2"), false);
});

Deno.test("rounds: a behavior's version and one no-op upgrade to it are a bump", () => {
  const before = MODEL("1.0", "");
  assertEquals(onlyBumped(before, MODEL("1.1", NOOP), "1.0", "1.1"), true);
  const noDescription = NOOP.replace(
    /\n\s*description:[^]*?data\.",/,
    "",
  );
  assertEquals(
    onlyBumped(before, MODEL("1.1", noDescription), "1.0", "1.1"),
    true,
  );
});

Deno.test("rounds: an upgrade that changes data, two of them, or any other change is not a bump", () => {
  const before = MODEL("1.0", "");
  const migrates = NOOP.replace(
    "(old: Record<string, unknown>) => old",
    "(old: Record<string, unknown>) => ({ ...old, x: 1 })",
  );
  assertEquals(onlyBumped(before, MODEL("1.1", migrates), "1.0", "1.1"), false);
  assertEquals(
    onlyBumped(before, MODEL("1.1", NOOP + NOOP), "1.0", "1.1"),
    false,
  );
  // Version bumped with no upgrade, which the dry run warns about anyway.
  assertEquals(onlyBumped(before, MODEL("1.1", ""), "1.0", "1.1"), true);
  assertEquals(
    onlyBumped(
      before,
      MODEL("1.1", NOOP).replace("methods: {}", "methods: { run }"),
      "1.0",
      "1.1",
    ),
    false,
  );
  // An upgrade to another version than the new one.
  assertEquals(
    onlyBumped(
      before,
      MODEL("1.1", NOOP.replace('"1.1"', '"1.2"')),
      "1.0",
      "1.1",
    ),
    false,
  );
  assertEquals(
    onlyBumped(before, MODEL("1.1", NOOP) + "\n", "1.0", "1.1"),
    false,
  );
});
