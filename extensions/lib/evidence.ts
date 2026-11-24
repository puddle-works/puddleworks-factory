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
  /** What readiness could not take from ci.yml for the run, when it ran. */
  note?: string;
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
  /^(-A|-[RWNESIP]+(=[\s\S]*)?|--(allow|deny|ignore)-[a-z-]+(=[\s\S]*)?|--permission-set(=[\s\S]*)?)$/;

/** Short flags that group a permission with others, such as `-qR`. */
const GROUPED = /^-[A-Za-z]*[ARWNESIP][A-Za-z]*(=|$)/;

/**
 * The long options of `deno test` (deno 2.9.7) that take the next word as
 * their value, so `--filter -A` filters and grants nothing. `-c` and `-L` do
 * too, also last in a group such as `-qc`.
 */
const VALUE_OPTIONS = new Set([
  "--filter",
  "--coverage-threshold",
  "--reporter",
  "--junit-path",
  "--retry",
  "--repeats",
  "--shard",
  "--related",
  "--ext",
  "--import-map",
  "--node-modules-linker",
  "--config",
  "--cert",
  "--min-dep-age",
  "--inspect-publish-uid",
  "--location",
  "--seed",
  "--preload",
  "--require",
  "--conditions",
  "--log-level",
]);

/** A word of a shell command, and whether the shell could expand it. */
interface Word {
  text: string;
  expands: boolean;
}

const SUBSTITUTES = "substitutes or expands words";

/**
 * The simple commands of a shell command line and their words, read as the
 * shell reads literal text but without running one. `'…'` and `"…"` keep
 * what is in them in one word, a backslash keeps the next character or joins
 * two lines, and `#` at the start of a word comments out the rest of the
 * line. Commands end at `&&`, `||`, `;`, `|`, `&` and line breaks outside
 * quotes, and a redirection is dropped with its target. A string says what
 * can't be read without a shell: substitution or expansion (`$` outside
 * single quotes, a backtick), an unmatched quote, a subshell or a
 * here-document.
 */
function shellCommands(
  line: string,
): { commands: Word[][]; plain: boolean } | string {
  const commands: Word[][] = [[]];
  let text = "", inWord = false, expands = false, redirect = false;
  let plain = true;
  const end = () => {
    if (inWord && redirect) redirect = false;
    else if (inWord) commands[commands.length - 1].push({ text, expands });
    text = "";
    inWord = false;
    expands = false;
  };
  const next = () => {
    end();
    redirect = false;
    commands.push([]);
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    // A carriage return is part of a word to sh, as any other character.
    if (c === " " || c === "\t") end();
    else if (c === "\n") next();
    else if (c === "#" && !inWord) {
      const eol = line.indexOf("\n", i);
      i = eol < 0 ? line.length : eol - 1;
    } else if (c === "\\" && i + 1 < line.length) {
      if (line[++i] !== "\n") {
        text += line[i];
        inWord = true;
      }
    } else if (c === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) return "has an unmatched quote";
      text += line.slice(i + 1, close);
      inWord = true;
      i = close;
    } else if (c === '"') {
      inWord = true;
      for (i++; line[i] !== '"'; i++) {
        if (i >= line.length) return "has an unmatched quote";
        let d = line[i];
        if (d === "\\" && '$`"\\\n'.includes(line[i + 1] || "x")) {
          d = line[++i];
          if (d === "\n") continue;
        } else if (d === "$" || d === "`") return SUBSTITUTES;
        text += d;
      }
    } else if (c === "$" || c === "`") return SUBSTITUTES;
    else if (c === "(" || c === ")") return "runs a subshell";
    else if (c === "&" && line[i + 1] === ">") {
      // bash redirects both outputs; sh, which CI uses, runs the command
      // before it in the background and redirects the next one.
      return "uses &>, which sh and bash read differently";
    } else if (c === "<" || c === ">") {
      if (line.startsWith("<<", i)) return "has a here-document";
      // A file descriptor's number belongs to the redirection, as in 2>&1.
      if (inWord && /^\d+$/.test(text)) text = "", inWord = false;
      else end();
      if (/[>&|]/.test(line[i + 1] ?? "")) i++;
      redirect = true;
      plain = false;
    } else if (c === "&" || c === "|" || c === ";") {
      if (line[i + 1] === c || (c === "|" && line[i + 1] === "&")) i++;
      next();
      plain = false;
    } else {
      if ("*?[{~".includes(c)) expands = true;
      text += c;
      inWord = true;
    }
  }
  end();
  return { commands, plain };
}

/**
 * The permission flags of the `deno test` command in the app's `ci.yml` (the
 * publish job's `tests` input, which render writes and the app's README says
 * to extend when its tests need permissions), read as the shell would split
 * it into words (see `shellCommands`). Only that command's own words count,
 * up to a `--`, and not the value of an option such as `--filter`: the input
 * may run other commands around it, whose flags are not deno's.
 *
 * With no `deno test` command in a non-empty input (`deno task test`, say),
 * there are no flags and `note` says so: readiness runs the tests with no
 * permissions rather than guess what the command gives them.
 *
 * Readiness runs deno without a shell, so a command it can't read as the
 * shell would is an error rather than a guess at its permissions: one that
 * substitutes or expands, leaves a quote open, uses a subshell or a
 * here-document or `&>` (which sh, as CI runs it, and bash read
 * differently), runs `deno test` more than once or after a `cd`, has a
 * flag-like word the
 * shell could expand, groups a permission with other short flags (`-qR`), or
 * takes a permission set with `-c`/`--config` or `--no-config`, which
 * readiness doesn't pass on. A permission set (`-P`, `--permission-set`) is
 * taken only from a single plain `deno test` command: one command, with no
 * separator, redirection or variable set for it.
 */
export function testPermissions(
  ciYml: string | null,
): { flags: string[]; note?: string } | { error: string } {
  const command = ciInput(ciYml, "tests").trim();
  const unsupported = (why: string) => ({
    error:
      `ci.yml's tests command ${why}, so readiness can't tell which deno permissions CI gives the tests: ${command}`,
  });
  const read = shellCommands(command);
  if (typeof read === "string") return unsupported(read);
  const commands = read.commands;
  // Variables set for the command alone come before it.
  const simple = commands.map((words) =>
    words.slice(words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w.text)))
  );
  const isRun = ([cmd, sub]: Word[]) =>
    cmd?.text === "deno" && sub?.text === "test";
  const runs = simple.filter(isRun);
  if (runs.length > 1) return unsupported("runs deno test more than once");
  // CI runs the line from the repo root, as readiness runs deno. After a cd
  // the config deno loads and relative permission paths are another
  // directory's.
  const before = simple.slice(0, Math.max(simple.findIndex(isRun), 0));
  if (before.some(([cmd]) => cmd?.text === "cd" || cmd?.text === "pushd")) {
    return unsupported("changes directory before deno test");
  }
  if (runs.length === 0) {
    return command
      ? {
        flags: [],
        note:
          `ci.yml's tests command runs no deno test readiness can read, so readiness ran the tests with no permissions, not that command: ${command}`,
      }
      : { flags: [] };
  }
  const flags: string[] = [];
  let config = false, noConfig = false;
  const args = runs[0].slice(2);
  for (let i = 0; i < args.length && args[i].text !== "--"; i++) {
    const { text: w, expands } = args[i];
    if (expands && /^[-*?[{]/.test(w)) {
      return unsupported(`has a word the shell could expand into flags (${w})`);
    }
    if (PERMISSION.test(w)) flags.push(w);
    else if (GROUPED.test(w)) {
      return unsupported(`groups permission flags with others (${w})`);
    } else {
      if (/^(--config(=|$)|-[a-zA-Z]*c)/.test(w)) config = true;
      if (/^--no-config(=|$)/.test(w)) noConfig = true;
      if (VALUE_OPTIONS.has(w) || /^-[a-zA-Z]*[cL]$/.test(w)) i++;
    }
  }
  const set = flags.some((w) => /^(-[A-Z]*P|--permission-set)/.test(w));
  if (set && config) {
    return unsupported("takes a permission set from a config file it names");
  }
  if (set && noConfig) {
    return unsupported(
      "takes a permission set with --no-config, a config option readiness doesn't pass on",
    );
  }
  // A permission set is trusted only from one plain `deno test` command:
  // no other command, separator, redirection or variable set for it, so no
  // shell construct can change where or how CI runs it.
  const used = commands.filter((words) => words.length);
  if (
    set && !(read.plain && used.length === 1 && used[0][0].text === "deno" &&
      used[0][1]?.text === "test")
  ) {
    return unsupported(
      "takes a permission set but is not a single plain deno test command",
    );
  }
  return { flags };
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
    if ("error" in permissions) return { tests: null, ...permissions };
    const note = permissions.note ? { note: permissions.note } : {};
    // The app's own tests, the same command and permissions its CI runs. No
    // shell is involved; the README says readiness runs them.
    // swamp-quality-ignore deno-command
    const run = await new Deno.Command(deno, {
      args: [
        "test",
        ...permissions.flags,
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
        ...note,
      };
    }
    return { tests, ...note };
  };
}
