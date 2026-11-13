/**
 * Evidence readiness takes from swamp and deno themselves, run on the checkout
 * as it is now, rather than from what the builder says.
 *
 * - The content hash and quality come from `swamp extension quality --json`.
 *   Its `cacheHash` is the hash `swamp extension push --dry-run` reports as
 *   `contentHash` and names the review report with, so a report written for
 *   other content is stale.
 * - Test outcomes come from running the app's tests with deno's junit
 *   reporter: a test passed only when it ran and has no failure.
 *
 * @module
 */
import { ciInput } from "./ci.ts";
import type { SwampRun } from "./recipe_check.ts";

/** What one quality run said about the current content. */
export interface QualityEvidence {
  /** The packaged content's sha-256, as push names the review report. */
  contentHash: string;
  earnedPoints: number;
  maxClientEarnablePoints: number;
  grade: string;
  gateFailures: string[];
  /** Factors the CLI can score that are not fully earned. */
  missing: string[];
  rubricVersion: number | null;
  swampVersion: string | null;
}

/** One test as the run reported it. */
export interface TestOutcome {
  name: string;
  passed: boolean;
}

/** The app's tests, run once. */
export interface TestRun {
  /** Null when the run gave no readable report; `error` says why. */
  tests: TestOutcome[] | null;
  error?: string;
}

/** Run the app's tests in dir and report each one. */
export type TestRunner = (dir: string) => Promise<TestRun>;

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;

/**
 * Read `swamp extension quality --json` output, or say why it can't be used.
 */
export function parseQuality(
  stdout: string,
): QualityEvidence | { error: string } {
  let raw: Record<string, unknown> | null;
  try {
    raw = record(JSON.parse(stdout));
  } catch {
    raw = null;
  }
  const hash = raw?.cacheHash;
  if (!raw || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    return { error: "swamp extension quality gave no content hash" };
  }
  const num = (v: unknown) => typeof v === "number" ? v : NaN;
  const factors = Array.isArray(raw.factors) ? raw.factors.map(record) : [];
  return {
    contentHash: hash,
    earnedPoints: num(raw.earnedPoints),
    maxClientEarnablePoints: num(raw.maxClientEarnablePoints),
    grade: typeof raw.grade === "string" ? raw.grade : "?",
    gateFailures: (Array.isArray(raw.gateFailures) ? raw.gateFailures : [])
      .map((g) => {
        const r = record(g);
        return typeof r?.message === "string" ? r.message : JSON.stringify(g);
      }),
    missing: factors
      .filter((f) => f?.status === "missing" || f?.status === "partial")
      .map((f) => String(f?.id)),
    rubricVersion: typeof raw.rubricVersion === "number"
      ? raw.rubricVersion
      : null,
    swampVersion: null,
  };
}

/** Score the checkout with swamp, as push would package it. */
export async function qualityOf(
  dir: string,
  runSwamp: SwampRun,
): Promise<QualityEvidence | { error: string }> {
  const out = await runSwamp(
    ["extension", "quality", "manifest.yaml", "--json"],
    dir,
  );
  if (out.code !== 0) {
    return {
      error: `swamp extension quality failed: ${
        (out.stderr || out.stdout).trim().split("\n").at(-1) ?? ""
      }`,
    };
  }
  return parseQuality(out.stdout);
}

const unescape = (s: string) =>
  s.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll(
    "&lt;",
    "<",
  ).replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/**
 * Each test in deno's junit report. A test passed only when its testcase has
 * no `<failure>`, `<error>` or `<skipped>`.
 */
export function parseJunit(xml: string): TestOutcome[] {
  const out: TestOutcome[] = [];
  const re =
    /<testcase\b[^>]*\bname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    const body = m[3] ?? "";
    out.push({
      name: unescape(m[1]),
      passed: !/<(failure|error|skipped)\b/.test(body),
    });
  }
  return out;
}

const decoder = new TextDecoder();

/**
 * A deno permission flag, passed to deno as written: `-A`, short flags alone
 * or combined (`-R`, `-RW`, `-RW=.`, where deno gives the value to the last),
 * `-P`/`--permission-set` (a permission set from the app's deno config), or
 * `--allow-…`/`--deny-…`/`--ignore-…`, each with any value.
 */
const PERMISSION =
  /^(-A|-[RWNESIP]+(=\S+)?|--(allow|deny|ignore)-[a-z-]+(=\S+)?|--permission-set(=\S+)?)$/;

/**
 * The permission flags of the `deno test` command in the app's `ci.yml` (the
 * publish job's `tests` input, which render writes and the app's README says
 * to extend when its tests need permissions). Only that command's own words
 * count, up to a `--`: the input may run other commands around it, joined by
 * `&&`, `||`, `;`, `|`, `&` or a line break, whose flags are not deno's. None
 * when no job gives the input or it runs no `deno test`.
 *
 * Readiness runs deno without a shell, so a command whose words it can't read
 * as the shell would is an error rather than a guess at its permissions: one
 * that quotes, escapes or substitutes, runs `deno test` more than once, groups
 * a permission with other short flags (`-qR`), or takes a permission set from
 * a config file named with `-c`/`--config`, which readiness doesn't pass on.
 */
export function testPermissions(
  ciYml: string | null,
): string[] | { error: string } {
  const command = ciInput(ciYml, "tests").trim();
  const unsupported = (why: string) => ({
    error:
      `ci.yml's tests command ${why}, so readiness can't tell which deno permissions CI gives the tests: ${command}`,
  });
  // A line continuation joins its lines, and a comment runs to the line end.
  const shell = command.replaceAll("\\\n", "").replace(/(^|\s)#.*/g, "");
  if (/['"`$\\]/.test(shell)) {
    return unsupported("quotes, escapes or substitutes words");
  }
  const runs = shell.split(/&&|\|\||[;|&\n]/).map((part) => {
    const words = part.trim().split(/\s+/);
    // Variables set for the command alone come before it.
    while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) words.shift();
    return words;
  }).filter(([cmd, sub]) => cmd === "deno" && sub === "test");
  if (runs.length > 1) return unsupported("runs deno test more than once");
  const args = runs[0]?.slice(2) ?? [];
  const words = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  const mixed = words.find((w) =>
    /^-[A-Za-z]*[ARWNESIP][A-Za-z]*(=|$)/.test(w) && !PERMISSION.test(w)
  );
  if (mixed) {
    return unsupported(`groups permission flags with others (${mixed})`);
  }
  const flags = words.filter((w) => PERMISSION.test(w));
  if (
    flags.some((w) => /^(-[A-Z]*P|--permission-set)/.test(w)) &&
    words.some((w) => /^(-c|--config)(=|$)/.test(w))
  ) {
    return unsupported("takes a permission set from a config file it names");
  }
  return flags;
}

/**
 * The app's tests, run with swamp's bundled deno, as the app's CI runs them
 * (`deno test extensions/models/` with the permissions its `ci.yml` gives
 * them, see `testPermissions`), with the junit reporter.
 */
export function realTests(runSwamp: SwampRun): TestRunner {
  return async (dir) => {
    const doctor = await runSwamp(["doctor", "extensions", "--json"], dir);
    let deno = "";
    try {
      deno = String(JSON.parse(doctor.stdout).denoPath ?? "");
    } catch {
      deno = "";
    }
    if (!deno) return { tests: null, error: "swamp named no deno to run" };
    let ci: string | null = null;
    try {
      ci = await Deno.readTextFile(`${dir}/.github/workflows/ci.yml`);
    } catch {
      ci = null;
    }
    const permissions = testPermissions(ci);
    if (!Array.isArray(permissions)) return { tests: null, ...permissions };
    // The app's own tests, the same command and permissions its CI runs. No
    // shell is involved; the README says readiness runs them.
    // swamp-quality-ignore deno-command
    const run = await new Deno.Command(deno, {
      args: [
        "test",
        ...permissions,
        "--reporter=junit",
        "extensions/models/",
      ],
      cwd: dir,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(300_000),
    }).output();
    const tests = parseJunit(decoder.decode(run.stdout));
    if (tests.length === 0) {
      return {
        tests: null,
        error: `deno test reported no tests (exit ${run.code})`,
      };
    }
    return { tests };
  };
}
