/**
 * Whether a reviewed app is ready to publish, and a summary that fits on one
 * screen for the builder to confirm against.
 *
 * The same files give the same answer every time. It reads the manifest, the
 * review report, the outcome spec's acceptance criteria and the reviewer's map
 * of each criterion to the tests that check it (`spec/acceptance.json`), and
 * the visibility check. Anything left undone is a blocker.
 *
 * @module
 */
import { parse as parseYaml } from "jsr:@std/yaml@1.0.12";
import type { Visibility } from "./visibility.ts";

/** Where the reviewer maps each acceptance criterion to its tests. */
export const ACCEPTANCE_PATH = "spec/acceptance.json";

/** One acceptance criterion and how it is checked. */
export interface CriterionCheck {
  id: string;
  /** The criterion, from the outcome spec. */
  text: string;
  /** Tests that check it, by name. */
  tests: string[];
  /** How it was checked by hand, when no test can. */
  manual: string;
  ok: boolean;
}

/** The review report, counted. */
export interface ReviewSummary {
  file: string;
  reviewedAt: string;
  counts: { pass: number; na: number; issue: number; pending: number };
  issues: Array<{ id: string; note: string }>;
}

/** The answer, with what is left to do. */
export interface Readiness {
  /** No blockers. */
  ready: boolean;
  package: string | null;
  version: string | null;
  /** The manifest's `visibility:`. */
  visibility: Visibility | null;
  /** What the visibility check recommended. */
  recommendation: Visibility | null;
  review: ReviewSummary | null;
  criteria: CriterionCheck[];
  blockers: string[];
  /** One screen of plain text: what would be published, and whether it is ready. */
  summary: string;
}

/** What the check reads. */
export interface ReadinessFacts {
  /** Text files, with paths relative to the repo root. */
  files: Array<{ path: string; text: string }>;
  /** The review report from the publish dry run, or null when it could not be read. */
  review: { path: string; text: string } | null;
  /** The visibility check's answer, or null when it has not run. */
  visibility: { recommendation: Visibility; canBePublic: boolean } | null;
  pullRequest?: string;
  commit?: string;
}

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`$\\]*`/.source;
const TEST_CALL = new RegExp(
  `(?:\\bDeno\\.test|\\.step)\\(\\s*(?:\\{\\s*name:\\s*)?(${STRING})`,
  "g",
);

function unquote(literal: string): string {
  if (literal.startsWith('"')) return JSON.parse(literal);
  return literal.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** Names of the `Deno.test` and `t.step` calls in a test file, in order. */
export function testNames(text: string): string[] {
  return [...text.matchAll(TEST_CALL)].map((m) => unquote(m[1]));
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The outcome spec with the highest specification.version in spec/. */
function latestOutcome(files: ReadinessFacts["files"]) {
  let best:
    | { path: string; version: number; criteria: Array<[string, string]> }
    | null = null;
  for (const f of files) {
    if (!/^spec\/outcome-spec\.[^/]*\.json$/.test(f.path)) continue;
    const spec = record(record(parseJson(f.text))?.specification);
    const version = Number(spec?.version);
    if (!spec || !Number.isFinite(version)) continue;
    if (best && best.version >= version) continue;
    const list = Array.isArray(spec.acceptanceCriteria)
      ? spec.acceptanceCriteria
      : [];
    best = {
      path: f.path,
      version,
      criteria: list.map((c) => [str(record(c)?.id), str(record(c)?.text)]),
    };
  }
  return best;
}

function checkReview(
  review: ReadinessFacts["review"],
  pkg: string | null,
  version: string | null,
  blockers: string[],
): ReviewSummary | null {
  if (!review) {
    blockers.push(
      "The review report could not be read: write it from the publish dry run's skeleton.",
    );
    return null;
  }
  const report = record(parseJson(review.text));
  if (!report) {
    blockers.push(`The review report ${review.path} is not JSON.`);
    return null;
  }
  const extension = str(report.extension);
  const reviewed = str(report.version);
  if (extension !== pkg || reviewed !== version) {
    blockers.push(
      `The review report is for ${extension || "nothing"}@${
        reviewed || "?"
      }; the manifest is ${pkg ?? "unreadable"}@${version ?? "?"}.`,
    );
  }
  const reviewedAt = str(report.reviewedAt);
  if (Number.isNaN(Date.parse(reviewedAt))) {
    blockers.push("The review report's reviewedAt is not a date.");
  }
  const dimensions = Array.isArray(report.dimensions)
    ? report.dimensions.map((d) => record(d) ?? {})
    : [];
  if (dimensions.length === 0) {
    blockers.push("The review report has no dimensions.");
  }
  const counts = { pass: 0, na: 0, issue: 0, pending: 0 };
  const issues: ReviewSummary["issues"] = [];
  for (const d of dimensions) {
    const id = str(d.id) || "(no id)";
    const verdict = str(d.verdict);
    if (verdict === "pass" || verdict === "na") counts[verdict]++;
    else if (verdict === "issue") {
      counts.issue++;
      issues.push({ id, note: str(d.note) });
      blockers.push(
        `Review issue, ${id}: ${
          str(d.note) || "(no note)"
        }. Fix it and review again.`,
      );
    } else {
      counts.pending++;
      blockers.push(`Review dimension ${id} has no verdict.`);
    }
  }
  return { file: review.path, reviewedAt, counts, issues };
}

function checkCriteria(
  files: ReadinessFacts["files"],
  blockers: string[],
): { criteria: CriterionCheck[]; outcomePath: string | null } {
  const outcome = latestOutcome(files);
  if (!outcome) return { criteria: [], outcomePath: null };

  const known = new Set(
    files.filter((f) => f.path.endsWith("_test.ts")).flatMap((f) =>
      testNames(f.text)
    ),
  );
  const raw = files.find((f) => f.path === ACCEPTANCE_PATH);
  const list = raw ? record(parseJson(raw.text))?.criteria : undefined;
  const mapped = new Map<string, Record<string, unknown>>();
  if (!raw) {
    blockers.push(
      `There is no ${ACCEPTANCE_PATH}: the reviewer maps each acceptance criterion to its tests there.`,
    );
  } else if (!Array.isArray(list)) {
    blockers.push(
      `${ACCEPTANCE_PATH} must be {"criteria": [{"id", "tests", "manual"}]}.`,
    );
  } else {
    for (const entry of list) {
      const e = record(entry) ?? {};
      mapped.set(str(e.id), e);
    }
  }

  const ids = new Set(outcome.criteria.map(([id]) => id));
  for (const id of mapped.keys()) {
    if (!ids.has(id)) {
      blockers.push(
        `${ACCEPTANCE_PATH} maps ${
          id || "(no id)"
        }, which is not an acceptance criterion in ${outcome.path}.`,
      );
    }
  }

  const criteria = outcome.criteria.map(([id, text]) => {
    const e = mapped.get(id);
    const tests = Array.isArray(e?.tests) ? e.tests.map(str) : [];
    const manual = str(e?.manual).trim();
    let ok = true;
    if (raw && Array.isArray(list) && !e) {
      blockers.push(`${id} is not in ${ACCEPTANCE_PATH}.`);
      ok = false;
    } else if (!e) ok = false;
    else if (tests.length === 0 && !manual) {
      blockers.push(`${id} has no test and no manual check.`);
      ok = false;
    }
    for (const t of tests.filter((t) => !known.has(t))) {
      blockers.push(
        `${id} names a test that is not in any *_test.ts: ${JSON.stringify(t)}`,
      );
      ok = false;
    }
    return { id, text, tests, manual, ok };
  });
  return { criteria, outcomePath: outcome.path };
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 3)}...` : s;

function summarise(
  r: Omit<Readiness, "summary">,
  facts: ReadinessFacts,
  outcomePath: string | null,
): string {
  const lines: string[] = [];
  const against = r.recommendation && r.visibility &&
      r.recommendation !== r.visibility
    ? `, against a ${r.recommendation} recommendation`
    : ` (recommended: ${r.recommendation ?? "not checked"})`;
  lines.push(
    clip(`${r.package ?? "(no package)"} ${r.version ?? "?"}`, 100),
    `Visibility: ${r.visibility ?? "?"}${against}`,
    `Ready to publish: ${
      r.ready
        ? "yes"
        : `no, ${r.blockers.length} blocker${
          r.blockers.length === 1 ? "" : "s"
        }`
    }`,
  );
  if (facts.pullRequest) lines.push(clip(`PR: ${facts.pullRequest}`, 100));
  if (facts.commit) lines.push(`Commit: ${facts.commit.slice(0, 12)}`);
  if (r.review) {
    const c = r.review.counts;
    lines.push(
      `Review: ${c.pass} pass, ${c.na} n/a, ${c.issue} issue, ${c.pending} pending (${
        r.review.reviewedAt || "no date"
      })`,
    );
  } else lines.push("Review: no report");

  if (!outcomePath) {
    lines.push("Acceptance criteria: no outcome spec, so none to check");
  } else {
    const ok = r.criteria.filter((c) => c.ok).length;
    lines.push(
      `${ok} of ${r.criteria.length} acceptance criteria checked (${outcomePath})`,
    );
    const shown = r.criteria.slice(0, 8);
    for (const c of shown) {
      const how = [
        c.tests.length
          ? `${c.tests.length} test${c.tests.length === 1 ? "" : "s"}`
          : "",
        c.manual ? `by hand: ${c.manual}` : "",
      ].filter(Boolean).join("; ") || "not checked";
      lines.push(
        clip(
          `  ${c.ok ? "ok" : "--"} ${c.id} ${clip(c.text, 50)}: ${how}`,
          100,
        ),
      );
    }
    if (r.criteria.length > shown.length) {
      lines.push(`  ... and ${r.criteria.length - shown.length} more`);
    }
  }

  if (r.blockers.length) {
    lines.push("Blockers:");
    const shown = r.blockers.slice(0, 6);
    for (const b of shown) lines.push(clip(`  - ${b}`, 100));
    if (r.blockers.length > shown.length) {
      lines.push(`  ... and ${r.blockers.length - shown.length} more`);
    }
  }
  return lines.join("\n");
}

/** Say whether the reviewed app is ready to publish, and summarise it. */
export function assessReadiness(facts: ReadinessFacts): Readiness {
  const blockers: string[] = [];
  let manifest: Record<string, unknown> | null = null;
  try {
    const raw = facts.files.find((f) => f.path === "manifest.yaml");
    manifest = raw ? record(parseYaml(raw.text)) : null;
  } catch {
    manifest = null;
  }
  const pkg = str(manifest?.name) || null;
  const version = str(manifest?.version) || null;
  if (!pkg || !version) {
    blockers.push(
      "There is no readable manifest.yaml with a name and version.",
    );
  }
  const visibility: Visibility | null = manifest
    ? (manifest.visibility === "public" ? "public" : "private")
    : null;

  const review = checkReview(facts.review, pkg, version, blockers);
  const { criteria, outcomePath } = checkCriteria(facts.files, blockers);

  if (!facts.visibility) {
    blockers.push(
      "The visibility check has not run: run @puddleworks/puddleworks-factory-visibility.",
    );
  } else if (visibility === "public" && !facts.visibility.canBePublic) {
    blockers.push(
      "The manifest says public, but the visibility check's required checks failed.",
    );
  }

  const result = {
    ready: blockers.length === 0,
    package: pkg,
    version,
    visibility,
    recommendation: facts.visibility?.recommendation ?? null,
    review,
    criteria,
    blockers,
  };
  return { ...result, summary: summarise(result, facts, outcomePath) };
}
