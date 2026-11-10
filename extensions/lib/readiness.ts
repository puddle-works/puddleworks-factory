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
import type { QualityEvidence, TestRun } from "./evidence.ts";

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
  /** Who checked it by hand, as the acceptance map says. */
  checkedBy?: string;
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
  /** How the recipe went, or why there is none; null when no phrase was agreed. */
  recipe: string | null;
  /** How each agreed phrase went. Left out when no check could run. */
  examples?: Array<{ phrase: string; passed: boolean; detail?: string }>;
  /** The content hash the evidence is for, from the quality run. */
  contentHash: string | null;
  /** How the app's tests went in the run readiness made. */
  tests: { passed: number; failed: number } | null;
  /** One screen of plain text: what would be published, and whether it is ready. */
  summary: string;
}

/** What the check reads. */
export interface ReadinessFacts {
  /** Text files, with paths relative to the repo root. */
  files: Array<{ path: string; text: string }>;
  /** The review report from the publish dry run, or null when it could not be read. */
  review: { path: string; text: string } | null;
  /**
   * The visibility checks on the files as they are now, or `outdated` when the
   * recorded check is for another checkout or by an older Factory, or null
   * when it has not run.
   */
  visibility:
    | { recommendation: Visibility; canBePublic: boolean }
    | "outdated"
    | null;
  /** What checking the recipe found, when it was checked. */
  recipe?: {
    line: string | null;
    blockers: string[];
    examples?: Array<{ phrase: string; passed: boolean; detail?: string }>;
  };
  /** `swamp extension quality` on the checkout as it is now. */
  quality: QualityEvidence | { error: string };
  /** The app's tests, run on the checkout as it is now. */
  tests: TestRun;
  pullRequest?: string;
  commit?: string;
}

/**
 * The dimensions of swamp's adversarial review. A report must give each a
 * verdict: one that leaves some out has not reviewed them.
 */
export const REVIEW_DIMENSIONS = [
  "credentials-secrets",
  "logging-quality",
  "error-handling",
  "testing-completeness",
  "idempotency-resilience",
  "api-contracts",
  "resource-management",
  "published-surface-hygiene",
  "schema-strictness",
  "lifetime-gc",
  "crud-completeness",
  "preflight-checks",
  "instance-names",
  "data-access",
  "version-upgrades",
];

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`$\\]*`/.source;
const TEST_CALL = new RegExp(
  `(?:\\bDeno\\.test|\\.step)(\\.ignore)?\\(\\s*(?:\\{\\s*name:\\s*)?(${STRING})`,
  "g",
);

/** The text with its comments blanked, strings left as they are. */
function withoutComments(text: string): string {
  return text.replace(
    new RegExp(`${STRING}|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)`, "g"),
    (m) => /^["'`]/.test(m) ? m : m.replace(/[^\n]/g, " "),
  );
}

function unquote(literal: string): string {
  if (literal.startsWith('"')) return JSON.parse(literal);
  return literal.slice(1, -1).replace(/\\(.)/g, "$1");
}

/**
 * Where the call whose `(` is at `open` ends, and its text with strings and
 * everything deeper than its own arguments' brackets blanked, so
 * `{ ignore: true }` in a test's body is not read as the test's own option.
 */
function callExtent(code: string, open: number): { end: number; own: string } {
  const string = new RegExp(`^(?:${STRING})`);
  let depth = 0;
  let own = "";
  for (let i = open; i < code.length; i++) {
    const quoted = /["'`]/.test(code[i]) && string.exec(code.slice(i));
    if (quoted) {
      own += " ";
      i += quoted[0].length - 1;
      continue;
    }
    const c = code[i];
    if ("([{".includes(c)) depth++;
    if (depth <= 2) own += c;
    if (")]}".includes(c) && --depth === 0) return { end: i, own };
  }
  return { end: code.length, own };
}

/**
 * Names of the `Deno.test` and `t.step` calls in a test file that run, in
 * order: not those in comments, ignored with `.ignore(` or an `ignore: true`
 * option, or inside an ignored test.
 */
export function testNames(text: string): string[] {
  const code = withoutComments(text);
  const names: string[] = [];
  let skipUntil = -1;
  for (const m of code.matchAll(TEST_CALL)) {
    const at = m.index ?? 0;
    if (at < skipUntil) continue;
    const { end, own } = callExtent(code, at + m[0].indexOf("("));
    if (m[1] || /\bignore:\s*true\b/.test(own)) skipUntil = end;
    else names.push(unquote(m[2]));
  }
  return names;
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

/** The phrases an outcome spec's recipe agreed. */
function outcomePhrases(spec: Record<string, unknown>): string[] {
  const examples = record(spec.recipe)?.examples;
  return (Array.isArray(examples) ? examples : [])
    .map((e) => str(record(e)?.phrase).trim())
    .filter(Boolean);
}

/** The outcome spec with the highest specification.version in spec/. */
export function latestOutcome(files: ReadinessFacts["files"]) {
  let best:
    | {
      path: string;
      version: number;
      criteria: Array<[string, string]>;
      phrases: string[];
    }
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
      phrases: outcomePhrases(spec),
    };
  }
  return best;
}

function checkReview(
  review: ReadinessFacts["review"],
  pkg: string | null,
  version: string | null,
  hash: string | null,
  blockers: string[],
): ReviewSummary | null {
  if (review && hash && !review.path.endsWith(`-${hash}.json`)) {
    blockers.push(
      `The review report ${review.path} is not for the content as it is now ` +
        `(${hash.slice(0, 12)}): the code changed after the review, or it is ` +
        "the wrong file. Review again from the publish dry run's skeleton.",
    );
  }
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
  } else {
    const ids = dimensions.map((d) => str(d.id));
    const given = new Set(ids);
    const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (twice.length) {
      blockers.push(
        `The review report gives ${twice.join(", ")} more than one verdict.`,
      );
    }
    const missing = REVIEW_DIMENSIONS.filter((id) => !given.has(id));
    if (missing.length) {
      blockers.push(
        `The review report has no verdict for ${
          missing.join(", ")
        }: review those too, from the publish dry run's skeleton.`,
      );
    }
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
  run: Map<string, boolean> | null,
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
      if (mapped.has(str(e.id))) {
        blockers.push(
          `${ACCEPTANCE_PATH} maps ${str(e.id) || "(no id)"} more than once.`,
        );
      }
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
    const by = record(e?.manual);
    const manual = (by ? str(by.check) : str(e?.manual)).trim();
    const checkedBy = by ? str(by.by).trim() : "";
    let ok = true;
    if (manual && !by) {
      blockers.push(
        `${id}'s manual check doesn't say who did it or how it went: write ` +
          `"manual": {"check": "what was run and seen", "by": "who", "passed": true}.`,
      );
      ok = false;
    } else if (by && (!manual || !checkedBy)) {
      blockers.push(`${id}'s manual check needs both check and by.`);
      ok = false;
    } else if (by && by.passed !== true) {
      blockers.push(`${id}'s manual check did not pass.`);
      ok = false;
    }
    if (raw && Array.isArray(list) && !e) {
      blockers.push(`${id} is not in ${ACCEPTANCE_PATH}.`);
      ok = false;
    } else if (!e) ok = false;
    else if (tests.length === 0 && !manual) {
      blockers.push(`${id} has no test and no manual check.`);
      ok = false;
    }
    for (const t of tests) {
      if (!known.has(t)) {
        blockers.push(
          `${id} names a test that is not in any *_test.ts: ${
            JSON.stringify(t)
          }`,
        );
        ok = false;
      } else if (run && run.get(t) !== true) {
        blockers.push(
          `${id}'s test ${JSON.stringify(t)} ${
            run.has(t) ? "failed" : "did not run"
          } when readiness ran the tests.`,
        );
        ok = false;
      } else if (!run) ok = false;
    }
    return {
      id,
      text,
      tests,
      manual,
      ...(checkedBy ? { checkedBy } : {}),
      ok,
    };
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
  lines.push(
    `Content: ${
      r.contentHash ? r.contentHash.slice(0, 12) : "not scored"
    }; tests: ${
      r.tests ? `${r.tests.passed} passed, ${r.tests.failed} failed` : "not run"
    }`,
  );
  if (r.review) {
    const c = r.review.counts;
    lines.push(
      `Review: ${c.pass} pass, ${c.na} n/a, ${c.issue} issue, ${c.pending} pending (${
        r.review.reviewedAt || "no date"
      })`,
    );
  } else lines.push("Review: no report");

  if (!outcomePath) {
    lines.push(
      "Acceptance criteria: no outcome spec, so acceptance rests on the app's tests passing",
    );
  } else {
    const ok = r.criteria.filter((c) => c.ok).length;
    lines.push(
      `${ok} of ${r.criteria.length} acceptance criteria checked (${outcomePath})`,
    );
    const shown = r.criteria.slice(0, 7);
    for (const c of shown) {
      const how = [
        c.tests.length
          ? `${c.tests.length} test${c.tests.length === 1 ? "" : "s"}`
          : "",
        c.manual
          ? `by hand${c.checkedBy ? ` (${c.checkedBy})` : ""}: ${c.manual}`
          : "",
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

  if (r.recipe) lines.push(clip(`Recipe: ${r.recipe}`, 400));

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
  // The registry publishes a manifest with no `visibility:` line as public.
  const visibility: Visibility | null = manifest
    ? (manifest.visibility === "private" ? "private" : "public")
    : null;

  const quality = "error" in facts.quality ? null : facts.quality;
  if (!quality) {
    blockers.push(
      `The quality check could not run, so nothing can be tied to the content: ${
        (facts.quality as { error: string }).error
      }.`,
    );
  } else {
    for (const g of quality.gateFailures) {
      blockers.push(`Quality gate: ${g}`);
    }
    if (
      quality.missing.length ||
      !(quality.earnedPoints >= quality.maxClientEarnablePoints)
    ) {
      blockers.push(
        `Quality: ${quality.earnedPoints}/${quality.maxClientEarnablePoints} ` +
          `client points; earn ${
            quality.missing.join(", ") || "the missing factors"
          }.`,
      );
    }
  }
  const hash = quality?.contentHash ?? null;

  const run = facts.tests.tests
    ? new Map(facts.tests.tests.map((t) => [t.name, t.passed]))
    : null;
  if (!facts.tests.tests) {
    blockers.push(
      `The app's tests could not be run: ${facts.tests.error ?? "no report"}.`,
    );
  } else {
    const failed = facts.tests.tests.filter((t) => !t.passed);
    if (failed.length) {
      blockers.push(
        `${failed.length} test${failed.length === 1 ? "" : "s"} failed: ${
          failed.slice(0, 3).map((t) => JSON.stringify(t.name)).join(", ")
        }${failed.length > 3 ? ", ..." : ""}.`,
      );
    }
  }

  const review = checkReview(facts.review, pkg, version, hash, blockers);
  const { criteria, outcomePath } = checkCriteria(facts.files, run, blockers);

  const given = manifest?.visibility;
  const checked = facts.visibility === "outdated" ? null : facts.visibility;
  if (facts.visibility === "outdated") {
    blockers.push(
      "The visibility check is for another checkout, or by an older Factory: " +
        "run @puddleworks/puddleworks-factory-visibility again.",
    );
  } else if (!checked) {
    blockers.push(
      "The visibility check has not run: run @puddleworks/puddleworks-factory-visibility.",
    );
  } else if (visibility === "public" && !checked.canBePublic) {
    blockers.push(
      given === undefined
        ? "The manifest has no visibility: line, so it publishes public, but the visibility check's required checks failed."
        : given === null || given === ""
        ? "The manifest has an empty visibility:, so it publishes public, but the visibility check's required checks failed."
        : given === "public"
        ? "The manifest says public, but the visibility check's required checks failed."
        : "The visibility check's required checks failed, so it can't be public.",
    );
  }
  if (
    given !== undefined && given !== null && given !== "" &&
    given !== "public" && given !== "private"
  ) {
    blockers.push(
      `The manifest's visibility: is ${
        JSON.stringify(given)
      }, not "private" or "public": set one of them.`,
    );
  }

  blockers.push(...(facts.recipe?.blockers ?? []));

  const result = {
    ready: blockers.length === 0,
    package: pkg,
    version,
    visibility,
    recommendation: checked?.recommendation ?? null,
    review,
    criteria,
    blockers,
    recipe: facts.recipe?.line ?? null,
    ...(facts.recipe?.examples ? { examples: facts.recipe.examples } : {}),
    contentHash: hash,
    tests: facts.tests.tests
      ? {
        passed: facts.tests.tests.filter((t) => t.passed).length,
        failed: facts.tests.tests.filter((t) => !t.passed).length,
      }
      : null,
  };
  return { ...result, summary: summarise(result, facts, outcomePath) };
}
