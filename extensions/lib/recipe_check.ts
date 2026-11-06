/**
 * Check an app's recipe with the real recipe engine: does each agreed phrase
 * reach this app?
 *
 * It runs in a throwaway swamp repo, so the app's checkout isn't touched:
 * pulling an extension leaves files in the repo it is pulled into. A recipe
 * that writes only says it would ask, so nothing in the app runs.
 *
 * @module
 */
import { stringify } from "jsr:@std/yaml@1.0.12";
import { assessRecipe, type DraftRecipe } from "./recipes.ts";

/** The extension that runs recipes. */
const ENGINE = "@puddleworks/recipes";

/** How long one swamp command may take. */
const TIMEOUT_MS = 120_000;

/** Run swamp in a directory. */
export type SwampRun = (
  args: string[],
  cwd: string,
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
export const realSwamp: SwampRun = async (args, cwd) => {
  // Only swamp's own CLI can run another extension. No shell is involved, so a
  // phrase stays one argument; the README says readiness starts swamp.
  // swamp-quality-ignore deno-command
  const { code, stdout, stderr } = await new Deno.Command("swamp", {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).output();
  return {
    code,
    stdout: decoder.decode(stdout),
    stderr: decoder.decode(stderr),
  };
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
  const r = await run(args, dir);
  if (r.code !== 0) throw new Error(failure(args, r));
  const attributes = JSON.parse(r.stdout)?.dataArtifacts?.[0]?.attributes;
  if (typeof attributes !== "object" || attributes === null) {
    throw new Error(`${method} gave no result`);
  }
  return attributes;
}

/** Whether this phrase reaches one of the app's recipes. */
async function checkPhrase(
  phrase: string,
  ids: string[],
  dir: string,
  run: SwampRun,
): Promise<ExampleCheck> {
  const failed = (detail: string) => ({
    phrase,
    passed: false,
    detail: detail.slice(0, 2000),
  });
  try {
    // A phrase may start with "@", which swamp would read as a file.
    const match = await runMethod(run, dir, "match", [`text=${phrase}`], true);
    if (match.matched !== true) return failed("No recipe matched this phrase.");
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

/** Run each phrase through the engine, in a repo made for it. */
async function checkExamples(
  recipes: Array<Record<string, unknown>>,
  phrases: string[],
  run: SwampRun,
): Promise<ExampleCheck[]> {
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
    const examples: ExampleCheck[] = [];
    for (const phrase of phrases) {
      examples.push(await checkPhrase(phrase, ids, dir, run));
    }
    return examples;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** The recipe in the repo, checked against the phrases agreed for the app. */
export async function recipeReadiness(
  files: Array<{ path: string; text: string }>,
  draft: { entryPointRef: string; recipe?: DraftRecipe },
  run: SwampRun = realSwamp,
): Promise<RecipeReadiness> {
  const found = assessRecipe(files, draft);
  if (found.phrases.length === 0) return { line: null, blockers: [] };
  if (found.none) return { line: `none. ${found.none}`, blockers: [] };
  if (found.recipes.length === 0) {
    return { line: "not checked", blockers: found.blockers };
  }
  let examples: ExampleCheck[];
  try {
    examples = await checkExamples(found.recipes, found.phrases, run);
  } catch (e) {
    return {
      line: "not checked",
      blockers: [
        ...found.blockers,
        `The recipe could not be checked: ${message(e)}`,
      ],
    };
  }
  const passed = examples.filter((e) => e.passed).length;
  return {
    line: `${passed} of ${examples.length} example phrases passed`,
    blockers: [
      ...found.blockers,
      ...examples.filter((e) => !e.passed).map((e) =>
        `The recipe does not answer "${e.phrase}": ${e.detail}`
      ),
    ],
    examples,
  };
}
