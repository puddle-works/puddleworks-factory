/**
 * Review rounds: when one may start, and the limit of two per build.
 *
 * Every adversarial review round of an app starts through the `round` method,
 * which records it here. A round is for one content hash: swamp names the
 * review report after it, so any change to what ships needs a new review.
 *
 * - Before any round, the publish dry run must have no warning except the
 *   review's own, and the version must not be published yet, so nothing
 *   found at publish forces another round.
 * - A build has at most `ROUND_LIMIT` rounds. One more needs the user's yes
 *   (`grant`), each time. Changing the version mid-build doesn't start a new
 *   count: a build ends only when it is published.
 * - Round 2 and later name the round before (`base`) and the files changed
 *   since, so the reviewer checks only that diff.
 * - A change that only bumps the version (the manifest's `version:`, a
 *   behavior's `version:` and a no-op upgrade to it) carries the last
 *   committed review over instead of starting a round. The caller proves it
 *   by hashing the content with those changes undone: it must be the hash
 *   the committed review was for.
 *
 * @module
 */
import { ciInput } from "./ci.ts";

/** Rounds a build may have before the user must agree to another. */
export const ROUND_LIMIT = 2;

/** The dry-run warnings about the review itself, which a round answers. */
const REVIEW_RULES = new Set([
  "adversarial-review-report",
  "adversarial-review-dimension-issue",
]);

/** One review of one content hash, or a review carried over to it. */
export interface ReviewRound {
  /** The manifest's version. */
  version: string;
  /**
   * `review`: a fresh agent reviews it. `carried`: only the version changed
   * since a committed review. `committed`: a complete report for this exact
   * content was already committed.
   */
  kind: "review" | "carried" | "committed";
  /** Its number in the build; 0 for one that is not a review round. */
  round: number;
  contentHash: string;
  /** The commit the content is at. */
  commit: string;
  /** The review report, relative to the checkout. */
  file: string;
  /** The round before's commit, for round 2 and later. */
  base: string | null;
  /** Files changed since `base`. */
  changed: string[];
  /** Past the limit, with the user's yes. */
  granted: boolean;
  /** For a carried review: the review it carries. */
  carriedFrom: { version: string; contentHash: string } | null;
  startedAt: string;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;

/** What the publish dry run said, for a round about to start. */
export interface DryRun {
  /** Everything to fix before a round may start. */
  blockers: string[];
  contentHash: string | null;
  /** The skeleton the review report is written from, when push gave one. */
  skeleton: unknown;
}

/**
 * The warnings an app accepts on purpose: the `accepted-warnings` input of
 * the publish job in its ci.yml, which puddle-tooling's publish passes to
 * publish.sh as ACCEPTED_WARNINGS. None when no job gives it a value.
 */
export function acceptedWarnings(ciYml: string | null): string[] {
  return ciInput(ciYml, "accepted-warnings").split(/\s+/).filter(Boolean);
}

/**
 * Read `swamp extension push --dry-run --json` as puddle-tooling's publish.sh
 * does. Every warning except version drift, the review's own and those the
 * app accepts blocks a round, as it would block the publish, and so does
 * every failed registry check, including a version that is already published.
 */
export function readDryRun(stdout: string, accepted: string[] = []): DryRun {
  let raw: Record<string, unknown> | null;
  try {
    raw = record(JSON.parse(stdout));
  } catch {
    raw = null;
  }
  if (!raw) {
    return {
      blockers: ["The publish dry run gave no JSON to read."],
      contentHash: null,
      skeleton: null,
    };
  }
  const blockers: string[] = [];
  const checks = Array.isArray(raw.registryChecks) ? raw.registryChecks : [];
  for (const c of checks.map(record)) {
    if (c?.status !== "failed") continue;
    blockers.push(
      c.name === "version-exists"
        ? `${c.message} Choose the next version (swamp extension version) ` +
          "and commit it before the round, so publishing doesn't need another."
        : `Registry check ${c.name}: ${c.message}`,
    );
  }
  let skeleton: unknown = null;
  for (const [family, list] of Object.entries(record(raw.warnings) ?? {})) {
    if (family === "versionDrift" || !Array.isArray(list)) continue;
    for (const w of list.map(record)) {
      const rule = String(w?.ruleId ?? w?.check ?? "warning");
      if (REVIEW_RULES.has(rule)) {
        if (rule === "adversarial-review-report") skeleton ??= w?.skeleton;
        continue;
      }
      if (accepted.includes(String(w?.ruleId ?? ""))) continue;
      blockers.push(`[${rule}] ${w?.message ?? w?.output ?? ""}`.trim());
    }
  }
  const hash = raw.contentHash;
  const contentHash = typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)
    ? hash
    : null;
  if (!contentHash) blockers.push("The publish dry run gave no content hash.");
  return { blockers, contentHash, skeleton: skeleton ?? null };
}

/** The review report file push looks for, relative to the checkout. */
export function reportFile(pkg: string, contentHash: string): string {
  return `swamp-extension-review/${
    pkg.replace(/[^a-zA-Z0-9._-]/g, "_")
  }-${contentHash}.json`;
}

/**
 * A report's version when it is complete for pkg: a verdict of pass or na
 * for every dimension, none pending or an issue. Null otherwise.
 */
export function completeReportVersion(
  text: string,
  pkg: string,
  dimensions: readonly string[],
): string | null {
  let report: Record<string, unknown> | null;
  try {
    report = record(JSON.parse(text));
  } catch {
    return null;
  }
  if (report?.extension !== pkg || typeof report.version !== "string") {
    return null;
  }
  const given = new Map(
    (Array.isArray(report.dimensions) ? report.dimensions : []).map((d) => [
      String(record(d)?.id),
      record(d)?.verdict,
    ]),
  );
  const ok = dimensions.every((id) =>
    given.get(id) === "pass" || given.get(id) === "na"
  );
  return ok ? report.version : null;
}

/** What to do about a round asked for now. */
export type RoundDecision =
  | { kind: "same"; round: ReviewRound }
  | {
    kind: "start";
    round: number;
    base: ReviewRound | null;
    granted: boolean;
  }
  | { kind: "blocked"; message: string };

/**
 * The rounds of the build in progress: those after the last round of the
 * version last published. Moving to a new version during a build (say the
 * old one turned out to be taken) keeps counting; only a publish ends a
 * build.
 */
export function buildRounds(
  rounds: ReviewRound[],
  published: string | null,
): ReviewRound[] {
  const last = published === null
    ? -1
    : rounds.findLastIndex((r) => r.version === published);
  return rounds.slice(last + 1);
}

/**
 * Whether a review round may start for this content. The same content as a
 * round already recorded is that round again, and costs nothing. Past
 * ROUND_LIMIT a round needs `grant`, the user's yes to that one round.
 */
export function decideRound(input: {
  rounds: ReviewRound[];
  version: string;
  contentHash: string;
  /** The version `result` last recorded as published. */
  published: string | null;
  grant: boolean;
}): RoundDecision {
  const build = buildRounds(input.rounds, input.published);
  const same = build.findLast((r) =>
    r.version === input.version && r.contentHash === input.contentHash
  );
  if (same) return { kind: "same", round: same };
  const reviews = build.filter((r) => r.kind === "review");
  const next = reviews.length + 1;
  const base = reviews.at(-1) ?? null;
  if (next > ROUND_LIMIT && !input.grant) {
    return {
      kind: "blocked",
      message: `Round ${next} would pass the limit of ${ROUND_LIMIT} review ` +
        `rounds for this build${
          base
            ? `, and what ships has changed since round ${base.round} (${
              base.commit.slice(0, 12)
            })`
            : ""
        }. Ask the user whether to have another round; only on yes, run the ` +
        "round again with grant=true. Otherwise undo the change, or stop and " +
        "show the user the blockers.",
    };
  }
  return { kind: "start", round: next, base, granted: next > ROUND_LIMIT };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether the only change from before to after in one file is a version
 * bump from oldVersion to newVersion: the manifest's `version:` line, or in
 * a behavior a `version:` line and one no-op upgrade entry to the new
 * version, `upgradeAttributes: (x) => x`. Exact: any other change, even
 * whitespace, is not a bump.
 */
export function onlyBumped(
  before: string,
  after: string,
  oldVersion: string,
  newVersion: string,
): boolean {
  if (oldVersion === newVersion) return false;
  const versionLine = new RegExp(
    `^(\\s*version:\\s*["']?)${escape(newVersion)}(["']?,?\\s*)$`,
    "gm",
  );
  const back = after.replace(versionLine, `$1${oldVersion}$2`);
  if (back === before) return true;
  const str = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/.source;
  const upgrade = new RegExp(
    `\\n[ \\t]*\\{\\s*toVersion:\\s*["']${escape(newVersion)}["'],\\s*` +
      `(?:description:\\s*(?:(?:${str})\\s*\\+\\s*)*(?:${str}),\\s*)?` +
      `upgradeAttributes:\\s*\\(\\s*(\\w+)\\s*(?::[^)]*)?\\)\\s*=>\\s*\\1\\s*,?\\s*\\},?(?=\\n)`,
    "g",
  );
  const found = back.match(upgrade) ?? [];
  return found.length === 1 && back.replace(upgrade, "") === before;
}

/**
 * What readiness says about the rounds of the content as it is now, given the
 * rounds of the build in progress (buildRounds).
 */
export function roundCheck(
  rounds: ReviewRound[],
  version: string | null,
  contentHash: string | null,
): { line: string; blocker?: string; round?: ReviewRound } {
  const round = rounds.findLast((r) =>
    r.version === version && r.contentHash === contentHash
  );
  if (round) {
    const line = round.kind === "review"
      ? `round ${round.round} of ${ROUND_LIMIT}${
        round.granted ? ", past the limit with the user's yes" : ""
      }`
      : round.kind === "carried"
      ? `carried from ${round.carriedFrom?.version}, since only the version changed`
      : "committed for this content before this build";
    return { line, round };
  }
  if (!contentHash) return { line: "round not checked" };
  const last = rounds.findLast((r) => r.kind === "review");
  const blocker = last && last.round >= ROUND_LIMIT
    ? `What ships changed after round ${last.round}, which froze it: ` +
      `\`git diff ${last.commit.slice(0, 12)}\` shows the change. Undo it, ` +
      "or ask the user for another round and start it with grant=true."
    : `No review round is recorded for this content (${
      contentHash.slice(0, 12)
    }): start one with @puddleworks/puddleworks-factory-round.`;
  return { line: "no round for this content", blocker };
}
