/**
 * Check an app's recipe with the real recipe engine: does each agreed phrase
 * reach this app?
 *
 * It runs in a throwaway swamp repo, so the app's checkout isn't touched:
 * pulling an extension leaves files in the repo it is pulled into. A recipe
 * that writes only says it would ask, so nothing in the app runs. An app whose
 * manifest says it only reads does run, once per phrase, to time it against
 * what the router allows.
 *
 * @module
 */
import { stringify } from "jsr:@std/yaml@1.0.12";
import {
  ANY_TURN_PROBES,
  assessRecipe,
  type DraftRecipe,
  onlyReads,
  RECIPE_BUDGET_SECONDS,
} from "./recipes.ts";
import { BUILT_IN_RECIPE_IDS } from "./names.ts";

/** The extension that runs recipes. */
const ENGINE = "@puddleworks/recipes";

/** How long one swamp command may take. */
const TIMEOUT_MS = 120_000;

/** How long a timed run may take before it is stopped: long enough to be sure. */
const CUT_OFF_MS = 30_000;

/** How long to wait for swamp's output once it has been told to stop. */
const STOP_GRACE_MS = 1_000;

/** Run swamp in a directory, for at most `timeoutMs` if given. */
export type SwampRun = (
  args: string[],
  cwd: string,
  timeoutMs?: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** How one agreed phrase went. */
export interface ExampleCheck {
  phrase: string;
  passed: boolean;
  detail?: string;
}

/** What readiness reports about the recipe. */
export interface RecipeReadiness {
  /** One line for the summary; null when no phrase was agreed. */
  line: string | null;
  blockers: string[];
  /** One per phrase. Left out when no check could run. */
  examples?: ExampleCheck[];
}

const decoder = new TextDecoder();

/** Swamp itself, as the method runs it. */
export const realSwamp: SwampRun = async (
  args,
  cwd,
  timeoutMs = TIMEOUT_MS,
) => {
  // Only swamp's own CLI can run another extension. No shell is involved, so a
  // phrase stays one argument; the README says readiness starts swamp.
  // swamp-quality-ignore deno-command
  const child = new Deno.Command("swamp", {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    // Its own process group, so stopping it stops the runs it started too.
    // Those would hold its pipes open and go on writing into `cwd`.
    detached: true,
  }).spawn();
  const stopAll = (signal: Deno.Signal) => {
    try {
      Deno.kill(-child.pid, signal);
    } catch { /* already gone */ }
  };
  let timedOut = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  let gaveUpTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    stopAll("SIGTERM");
    killer = setTimeout(() => stopAll("SIGKILL"), STOP_GRACE_MS);
  }, timeoutMs);
  // A process that left the group could still hold the pipes: stop waiting.
  const gaveUp = new Promise<never>((_, reject) => {
    gaveUpTimer = setTimeout(
      () => reject(new Error(`swamp gave no answer in ${timeoutMs / 1000} s`)),
      timeoutMs + 2 * STOP_GRACE_MS,
    );
  });
  try {
    const { code, stdout, stderr } = await Promise.race([
      child.output(),
      gaveUp,
    ]);
    if (timedOut) {
      throw new Error(`swamp gave no answer in ${timeoutMs / 1000} s`);
    }
    return {
      code,
      stdout: decoder.decode(stdout),
      stderr: decoder.decode(stderr),
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(killer);
    clearTimeout(gaveUpTimer);
  }
};

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/** What a failed swamp command said, or that it failed. */
function failure(
  args: string[],
  r: { code: number; stdout: string; stderr: string },
): string {
  const said = (r.stderr || r.stdout).trim().slice(-500);
  return `swamp ${args.slice(0, 2).join(" ")} exited ${r.code}${
    said ? `: ${said}` : ""
  }`;
}

/** The attributes of the data a `--json` behavior run gave. */
async function runMethod(
  run: SwampRun,
  dir: string,
  method: string,
  inputs: string[],
  literal = false,
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  const args = [
    "behavior",
    "run",
    "recipes",
    method,
    "--repo-dir",
    dir,
    ...inputs.flatMap((i) => ["--input", i]),
    "--input",
    `repoDir=${dir}`,
    ...(literal ? ["--literal-inputs"] : []),
    "--json",
  ];
  const r = await run(args, dir, timeoutMs);
  if (r.code !== 0) throw new Error(failure(args, r));
  const attributes = JSON.parse(r.stdout)?.dataArtifacts?.[0]?.attributes;
  if (typeof attributes !== "object" || attributes === null) {
    throw new Error(`${method} gave no result`);
  }
  return attributes;
}

/**
 * Why the recipe engine would drop each recipe it loads, by the engine's own
 * rules for a recipe's id and pattern. The engine only logs these, and a run
 * with --json keeps its log out of the output, so `match` alone would just say
 * nothing matched.
 */
export function droppedRecipes(
  recipes: Array<Record<string, unknown>>,
): string[] {
  const taken = new Set(BUILT_IN_RECIPE_IDS);
  const why: string[] = [];
  for (const r of recipes) {
    const id = String(r.id);
    const drop = (reason: string) =>
      why.push(`The recipe engine drops the recipe "${id}": ${reason}.`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      drop("its id must be lowercase letters, digits and hyphens");
      continue;
    }
    if (taken.has(id)) {
      drop(
        BUILT_IN_RECIPE_IDS.includes(id)
          ? "one of the engine's own recipes has that id"
          : "an earlier recipe has that id",
      );
      continue;
    }
    let pattern: RegExp;
    try {
      pattern = new RegExp(`^(?:${String(r.pattern)})$`, "i");
    } catch (e) {
      drop(`its pattern is not a valid regex (${message(e)})`);
      continue;
    }
    if (ANY_TURN_PROBES.some((p) => pattern.test(p))) {
      drop("its pattern would match any turn");
      continue;
    }
    taken.add(id);
  }
  return why;
}

/** Whether this phrase reaches one of the app's recipes. */
async function checkPhrase(
  phrase: string,
  ids: string[],
  dir: string,
  run: SwampRun,
  dropped: string[],
): Promise<ExampleCheck> {
  const failed = (detail: string) => ({
    phrase,
    passed: false,
    detail: detail.slice(0, 2000),
  });
  try {
    // A phrase may start with "@", which swamp would read as a file.
    const match = await runMethod(run, dir, "match", [`text=${phrase}`], true);
    if (match.matched !== true) {
      return failed(
        dropped.length > 0
          ? dropped.join(" ")
          : "No recipe matched this phrase.",
      );
    }
    if (!ids.includes(String(match.recipeId))) {
      return failed(`It matched the recipe "${match.recipeId}" instead.`);
    }
    const done = await runMethod(run, dir, "execute", [
      `recipeId=${match.recipeId}`,
      `captures:json=${JSON.stringify(match.captures ?? [])}`,
      "mode=shadow",
    ]);
    if (done.ok !== true) {
      return failed(String(done.error || "The recipe could not run."));
    }
    return { phrase, passed: true };
  } catch (e) {
    return failed(message(e));
  }
}

/** The app's checkout, for the checks that load it, and a clock for the tests. */
export interface AppUnderCheck {
  dir: string;
  now?: () => number;
}

/** What loading and running the app added to the phrases' results. */
interface AppCheck {
  blockers: string[];
  note?: string;
}

/** What a passed example says was checked, so the result doesn't claim more. */
function passedDetail(seconds: number | undefined): string {
  return seconds === undefined
    ? "The recipe engine routed this phrase to the app; the app was not run."
    : `The recipe engine routed this phrase to the app, which ran in ${
      seconds.toFixed(1)
    } s; its answer was not checked.`;
}

/** The method each recipe calls that the app's type doesn't have. */
async function missingMethods(
  recipes: Array<Record<string, unknown>>,
  dir: string,
  run: SwampRun,
): Promise<string[]> {
  const blockers: string[] = [];
  for (const type of new Set(recipes.map((r) => String(r.extension)))) {
    const args = ["behavior", "type", "describe", type, "--json"];
    const r = await run(args, dir);
    if (r.code !== 0) throw new Error(failure(args, r));
    const methods = JSON.parse(r.stdout)?.methods;
    if (!Array.isArray(methods)) throw new Error(`${type} lists no methods`);
    const names = methods.map((m) => String(m?.name));
    for (const recipe of recipes.filter((x) => x.extension === type)) {
      if (!names.includes(String(recipe.method))) {
        blockers.push(
          `The recipe "${recipe.id}" calls the method "${recipe.method}", which ${type} doesn't have. It has: ${
            names.map((n) => `"${n}"`).join(", ")
          }.`,
        );
      }
    }
  }
  return blockers;
}

/**
 * Run an app that only reads for each phrase, and see if it answers in time.
 * `ran` gets how long each phrase's run took, for each one that ran.
 */
async function timeRuns(
  recipes: Array<Record<string, unknown>>,
  phrases: string[],
  dir: string,
  run: SwampRun,
  now: () => number,
  ran: Map<string, number>,
): Promise<AppCheck> {
  const notTimed = (why: string) => ({
    blockers: [],
    note: `Speed not timed: ${why.slice(0, 300)}`,
  });
  const tooSlow = (phrase: string, what: string) => ({
    blockers: [
      `The recipe ${what} on "${phrase}", and must answer within ${RECIPE_BUDGET_SECONDS} s or the router gives up on it: add a method that answers from the latest stored result, and point the recipe at it, as the app's CLAUDE.md says.`,
    ],
  });
  await Deno.writeTextFile(
    `${dir}/puddlerouter.yaml`,
    stringify({
      allow: [
        ...new Set(
          recipes.map((r) => `${String(r.extension).split("/")[0]}/*`),
        ),
      ],
      reads: [...new Set(recipes.map((r) => `${r.extension} ${r.method}`))],
      recipes,
    }),
  );
  let slowest = 0;
  for (const phrase of phrases) {
    const match = await runMethod(run, dir, "match", [`text=${phrase}`], true);
    const started = now();
    let done: Record<string, unknown>;
    try {
      done = await runMethod(
        run,
        dir,
        "execute",
        [
          `recipeId=${match.recipeId}`,
          `captures:json=${JSON.stringify(match.captures ?? [])}`,
          "mode=shadow",
        ],
        false,
        CUT_OFF_MS,
      );
    } catch (e) {
      return now() - started >= CUT_OFF_MS
        ? tooSlow(phrase, `did not finish in ${CUT_OFF_MS / 1000} s`)
        : notTimed(message(e));
    }
    if (done.action !== "ran") {
      return notTimed(`the engine answered "${done.action}" and didn't run it`);
    }
    if (done.ok !== true) {
      return notTimed(String(done.error || "the run failed"));
    }
    const seconds = (now() - started) / 1000;
    ran.set(phrase, seconds);
    if (seconds > RECIPE_BUDGET_SECONDS) {
      return tooSlow(phrase, `took ${seconds.toFixed(1)} s`);
    }
    slowest = Math.max(slowest, seconds);
  }
  return {
    blockers: [],
    note: `Slowest run ${
      slowest.toFixed(1)
    } s, of ${RECIPE_BUDGET_SECONDS} s allowed.`,
  };
}

/** Load the app in the repo made for the check, then check what needs it. */
async function checkApp(
  files: Array<{ path: string; text: string }>,
  recipes: Array<Record<string, unknown>>,
  phrases: string[],
  dir: string,
  run: SwampRun,
  app: AppUnderCheck,
  ran: Map<string, number>,
): Promise<AppCheck> {
  try {
    // Swamp runs from the throwaway repo, so a relative path wouldn't reach it.
    const where = app.dir.startsWith("/")
      ? app.dir
      : `${Deno.cwd()}/${app.dir}`;
    const args = ["extension", "source", "add", where, "--json"];
    const added = await run(args, dir);
    if (added.code !== 0) throw new Error(failure(args, added));
    const blockers = await missingMethods(recipes, dir, run);
    if (blockers.length > 0) return { blockers };
  } catch (e) {
    return {
      blockers: [],
      note: `Method and speed not checked: ${message(e).slice(0, 300)}`,
    };
  }
  if (!onlyReads(files)) {
    return {
      blockers: [],
      note:
        "Speed not timed: the manifest doesn't say effects-read, so it may change things and readiness doesn't run it.",
    };
  }
  try {
    return await timeRuns(
      recipes,
      phrases,
      dir,
      run,
      app.now ?? (() => performance.now()),
      ran,
    );
  } catch (e) {
    return {
      blockers: [],
      note: `Speed not timed: ${message(e).slice(0, 300)}`,
    };
  }
}

/** Run each phrase through the engine, in a repo made for it. */
async function checkExamples(
  files: Array<{ path: string; text: string }>,
  recipes: Array<Record<string, unknown>>,
  phrases: string[],
  run: SwampRun,
  app?: AppUnderCheck,
): Promise<{ examples: ExampleCheck[]; app: AppCheck }> {
  const ran = new Map<string, number>();
  const dir = await Deno.makeTempDir({ prefix: "factory-recipe-check-" });
  try {
    // Made here because a first run would make it, and say so ahead of its JSON.
    for (
      const args of [
        ["repo", "init"],
        ["extension", "pull", ENGINE],
        ["behavior", "create", ENGINE, "recipes", "--json"],
      ]
    ) {
      const r = await run(args, dir);
      if (r.code !== 0) throw new Error(failure(args, r));
    }
    const allow = [
      ...new Set(recipes.map((r) => `${String(r.extension).split("/")[0]}/*`)),
    ];
    await Deno.writeTextFile(
      `${dir}/puddlerouter.yaml`,
      stringify({ allow, recipes }),
    );
    const ids = recipes.map((r) => String(r.id));
    const dropped = droppedRecipes(recipes);
    const examples: ExampleCheck[] = [];
    for (const phrase of phrases) {
      examples.push(await checkPhrase(phrase, ids, dir, run, dropped));
    }
    // A phrase that doesn't reach the app already blocks, so the app can wait.
    const checked = app && examples.every((e) => e.passed)
      ? await checkApp(files, recipes, phrases, dir, run, app, ran)
      : { blockers: [] };
    return {
      examples: examples.map((e) =>
        e.passed ? { ...e, detail: passedDetail(ran.get(e.phrase)) } : e
      ),
      app: checked,
    };
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** The recipe in the repo, checked against the phrases agreed for the app. */
export async function recipeReadiness(
  files: Array<{ path: string; text: string }>,
  draft: { entryPointRef: string; recipe?: DraftRecipe },
  run: SwampRun = realSwamp,
  app?: AppUnderCheck,
): Promise<RecipeReadiness> {
  const found = assessRecipe(files, draft);
  if (found.phrases.length === 0) {
    return { line: null, blockers: found.blockers };
  }
  if (found.none) {
    return { line: `none. ${found.none}`, blockers: found.blockers };
  }
  if (found.recipes.length === 0) {
    return { line: "not checked", blockers: found.blockers };
  }
  let checked: { examples: ExampleCheck[]; app: AppCheck };
  try {
    checked = await checkExamples(
      files,
      found.recipes,
      found.phrases,
      run,
      app,
    );
  } catch (e) {
    return {
      line: "not checked",
      blockers: [
        ...found.blockers,
        `The recipe could not be checked: ${message(e)}`,
      ],
    };
  }
  const { examples } = checked;
  const passed = examples.filter((e) => e.passed).length;
  return {
    line: `${passed} of ${examples.length} example phrases passed${
      found.skipped === 0
        ? ""
        : `. ${found.skipped} more ${
          found.skipped === 1 ? "phrase" : "phrases"
        } not checked`
    }${checked.app.note ? `. ${checked.app.note}` : ""}`,
    blockers: [
      ...found.blockers,
      ...examples.filter((e) => !e.passed).map((e) =>
        `The recipe does not answer "${e.phrase}": ${e.detail}`
      ),
      ...checked.app.blockers,
    ],
    examples,
  };
}
