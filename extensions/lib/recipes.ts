/**
 * An app's recipe: what lets a phrase agreed for an app reach it, through
 * `@puddleworks/recipes`.
 *
 * A recipe calls exactly one method, and can only pass it a number, a repo or
 * a word taken from the phrase. `recipeFit` says whether a spec fits that, and
 * gives the pattern when it does. `assessRecipe` says what readiness needs to
 * know about the recipe now in the app's repo. Both are pure.
 *
 * The rules for a recipe workflow follow `recipeFromWorkflow` in
 * puddle-works/puddlerecipes, which is what reads it once it ships.
 *
 * @module
 */
import { parse as parseYaml } from "jsr:@std/yaml@1.0.12";
import type { Specification } from "../contracts/app_spec_v1.ts";
import { latestOutcome } from "./readiness.ts";

/** The manifest label that says an extension ships recipes. */
export const RECIPE_LABEL = "puddlerouter-recipe";

/** The draft's `each.line`, until the builder knows what each item holds. */
export const DRAFT_LINE = "{TODO_field_of_each_item}";

/**
 * Seconds a recipe's method may take. The router gives up on a turn after 15 s,
 * and has to route it and start swamp in that time too.
 */
export const RECIPE_BUDGET_SECONDS = 10;

/** The most captures the recipe engine takes. */
const MAX_CAPTURES = 9;

/** The most examples a build result reports. */
const MAX_EXAMPLES = 50;

/** One thing a recipe takes from the phrase, for the input of the same name. */
export interface Piece {
  name: string;
  shape: "int" | "repo" | "word";
}

/** The inputs a recipe fills from its pattern's captures. */
export type RecipeInputs = Record<
  string,
  { capture: number; as: Piece["shape"] }
>;

/** A spec that fits, or why it doesn't; null when it asks for no recipe. */
export type RecipeFit =
  | { pattern: string; inputs: RecipeInputs }
  | { reason: string }
  | null;

const CAPTURE = { int: String.raw`\d{1,6}`, repo: String.raw`[\w.-]+/[\w.-]+` };
const TOKEN = {
  int: String.raw`\b\d{1,6}\b`,
  repo: CAPTURE.repo,
};

/** Turns no recipe is for, as the engine tries them to refuse a catch-all. */
const ANY_TURN_PROBES = [
  "",
  "x",
  "please fix the bug in this file",
  "what should we do next?",
  "Refactor the login page, then run the tests.",
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One piece of a pattern: the words each phrase has at this point. */
function oneOf(words: string[]): string {
  const unique = [...new Set(words)].map(escapeRegex);
  return unique.length === 1 ? unique[0] : `(?:${unique.join("|")})`;
}

/** A phrase cut at its tokens: the words between them, and the pieces in order. */
function cut(
  phrase: string,
  pieces: Piece[],
): { words: string[]; order: string[] } | { reason: string } {
  const shapes = (["repo", "int"] as const).filter((s) =>
    pieces.some((p) => p.shape === s)
  );
  if (shapes.length === 0) return { words: [phrase], order: [] };
  const token = new RegExp(
    shapes.map((s) => `(?<${s}>${TOKEN[s]})`).join("|"),
    "g",
  );
  const left = {
    int: pieces.filter((p) => p.shape === "int"),
    repo: pieces.filter((p) => p.shape === "repo"),
  };
  const words: string[] = [];
  const order: string[] = [];
  let at = 0;
  for (const m of phrase.matchAll(token)) {
    const shape = m.groups?.repo ? "repo" : "int";
    const piece = left[shape].shift();
    if (!piece) {
      return {
        reason: `The phrase "${phrase}" has more ${
          shape === "int" ? "numbers" : "repos"
        } than the recipe has pieces for, so which is which can't be told.`,
      };
    }
    words.push(phrase.slice(at, m.index));
    order.push(piece.name);
    at = m.index + m[0].length;
  }
  words.push(phrase.slice(at));
  const missing = [...left.int, ...left.repo];
  if (missing.length > 0) {
    return {
      reason: `The phrase "${phrase}" doesn't show where the piece "${
        missing[0].name
      }" goes.`,
    };
  }
  return { words, order };
}

/**
 * A pattern that matches each phrase as written, whatever its case and with
 * or without trailing `?.!`, with one capture per piece. Every phrase must
 * have its pieces in the same order, so a capture has one number. The words
 * around each capture are alternatives, which may widen it a little.
 *
 * A `word` piece can't be found in a phrase, since any word could be it:
 * `recipeFit` refuses those first.
 */
export function recipePattern(
  phrases: string[],
  pieces: Piece[],
): { pattern: string; order: string[] } | { reason: string } {
  const cuts: Array<{ words: string[]; order: string[] }> = [];
  for (const phrase of phrases) {
    // Spaces as the engine leaves a turn: it squeezes them before matching.
    const bare = phrase.trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
    if (!bare) {
      return { reason: `The phrase "${phrase}" has no words to match.` };
    }
    const c = cut(bare, pieces);
    if ("reason" in c) return c;
    cuts.push(c);
  }
  const order = cuts[0].order;
  if (cuts.some((c) => c.order.join() !== order.join())) {
    return {
      reason:
        "The phrases have the recipe's pieces in a different order, and a capture has only one number.",
    };
  }
  // Pieces of one shape fill in the order listed, so a phrase that words them
  // another way would quietly pass each to the other's input.
  const wording = (c: { words: string[] }) => c.words.join("\0").toLowerCase();
  if (
    new Set(pieces.map((p) => p.shape)).size < pieces.length &&
    cuts.some((c) => wording(c) !== wording(cuts[0]))
  ) {
    return {
      reason:
        "The phrases word pieces of the same shape differently, so which is which can't be told: use the same words in each phrase, or write the pattern by hand.",
    };
  }
  const shapeOf = new Map(pieces.map((p) => [p.name, p.shape]));
  let pattern = "^";
  for (let i = 0; i <= order.length; i++) {
    pattern += oneOf(cuts.map((c) => c.words[i]));
    if (i < order.length) {
      pattern += `(${CAPTURE[shapeOf.get(order[i]) as "int" | "repo"]})`;
    }
  }
  pattern += "[?.!]*$";
  const made = new RegExp(`^(?:${pattern})$`, "i");
  if (ANY_TURN_PROBES.some((p) => made.test(p))) {
    return {
      reason:
        "The phrases are so short the recipe would answer any turn, and the recipe engine refuses that.",
    };
  }
  return { pattern, order };
}

/** Whether the spec's recipe fits one method call. Pure. */
export function recipeFit(spec: Specification): RecipeFit {
  const recipe = spec.recipe;
  if (!recipe?.examples.length) return null;
  const { pieces } = recipe;
  const specInputs = new Map(spec.inputs.map((i) => [i.name, i]));
  for (const piece of pieces) {
    const input = specInputs.get(piece.name);
    if (!input) {
      return {
        reason:
          `The recipe's piece "${piece.name}" has no input of that name to go to.`,
      };
    }
    if (piece.shape === "int" && !["integer", "number"].includes(input.type)) {
      return {
        reason:
          `The recipe's piece "${piece.name}" is a number, but that input is a ${input.type}.`,
      };
    }
    if (piece.shape !== "int" && input.type !== "string") {
      return {
        reason:
          `The recipe's piece "${piece.name}" is text, but that input is a ${input.type}.`,
      };
    }
  }
  for (const input of spec.inputs) {
    if (input.required && !pieces.some((p) => p.name === input.name)) {
      return {
        reason:
          `The input "${input.name}" is required and the recipe has no piece for it: a recipe can only pass a number, a repo or one word taken from the phrase.`,
      };
    }
  }
  const word = pieces.find((p) => p.shape === "word");
  if (word) {
    return {
      reason:
        `The recipe's piece "${word.name}" is a word, and the example phrases can't show which word it is, so the pattern has to be written by hand.`,
    };
  }
  if (pieces.length > MAX_CAPTURES) {
    return {
      reason:
        `The recipe has ${pieces.length} pieces, and a recipe can capture at most ${MAX_CAPTURES}.`,
    };
  }
  const made = recipePattern(recipe.examples.map((e) => e.phrase), pieces);
  if ("reason" in made) return made;
  const inputs: RecipeInputs = {};
  made.order.forEach((name, i) => {
    const as = pieces.find((p) => p.name === name)!.shape;
    inputs[name] = { capture: i + 1, as };
  });
  return { pattern: made.pattern, inputs };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The one spelling of an input the recipe engine reads. */
const REF = /^\$\{\{ inputs\.(\w+) \}\}$/;

/** The recipe in a workflow, as the engine would read it, or what's wrong. */
export function recipeFromWorkflow(
  wf: unknown,
): { recipe: Record<string, unknown> } | { error: string } {
  if (!isObj(wf)) return { error: "not a workflow" };
  const tag = isObj(wf.tags) ? wf.tags.puddlerouterRecipe : undefined;
  if (typeof tag !== "string") return { error: "no puddlerouterRecipe tag" };
  let recipe: unknown;
  try {
    recipe = JSON.parse(tag);
  } catch {
    return { error: "the puddlerouterRecipe tag is not JSON" };
  }
  if (!isObj(recipe)) {
    return { error: "the puddlerouterRecipe tag is not JSON" };
  }
  const steps = stepsOf(wf);
  if (steps.length !== 1) return { error: "must have exactly one step" };
  const task = isObj(steps[0]) && isObj(steps[0].task) ? steps[0].task : {};
  if (task.type !== "model_method") {
    return { error: "the step must be a model_method" };
  }
  if (
    typeof task.methodName !== "string" ||
    typeof task.modelIdOrName !== "string"
  ) return { error: "the step has no method or definition" };
  const captures = isObj(recipe.inputs) ? recipe.inputs : {};
  const fixed: Record<string, string> = {};
  const fed = new Set<string>();
  for (
    const [name, value] of Object.entries(isObj(task.inputs) ? task.inputs : {})
  ) {
    if (typeof value === "number" || typeof value === "boolean") {
      fixed[name] = String(value);
    } else if (typeof value !== "string") {
      return { error: `step input ${name} must be a word or an input` };
    } else if (REF.test(value)) {
      if (REF.exec(value)![1] !== name || !(name in captures)) {
        return {
          error: `step input ${name} must be \${{ inputs.${name} }} with a ` +
            `capture declared for ${name}`,
        };
      }
      fed.add(name);
    } else if (value.includes("${{")) {
      return {
        error: `step input ${name} may only be a fixed word or an input`,
      };
    } else fixed[name] = value;
  }
  for (const name of Object.keys(captures)) {
    if (!fed.has(name)) return { error: `capture ${name} is not a step input` };
  }
  return {
    recipe: {
      ...recipe,
      method: task.methodName,
      definition: task.modelIdOrName,
      fixed,
    },
  };
}

function stepsOf(wf: Record<string, unknown>): unknown[] {
  return (Array.isArray(wf.jobs) ? wf.jobs : []).flatMap((j) =>
    isObj(j) && Array.isArray(j.steps) ? j.steps : []
  );
}

/** What `render` recorded about the recipe. */
export interface DraftRecipe {
  /** The phrases agreed in the spec it rendered. */
  examples: string[];
  /** The names of the recipe's pieces. */
  pieces: string[];
  /** The recipe workflow it wrote. */
  workflow?: string;
  /** Why it wrote none. */
  reason?: string;
}

/** What readiness needs to know about the recipe in the app's repo. */
export interface RecipeFindings {
  /** The agreed phrases, from the draft and the newest outcome spec. */
  phrases: string[];
  /** The recipes in the repo, as `puddlerouter.yaml` takes them. */
  recipes: Array<Record<string, unknown>>;
  blockers: string[];
  /** How many agreed phrases are past the limit, and so go unchecked. */
  skipped: number;
  /** Why there is no recipe, when that's no fault of the build. */
  none?: string;
}

function parsedOrNull(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

/** Why the entry point can't be called by a recipe, if it can't. */
function entryWorkflow(
  files: Array<{ path: string; text: string }>,
  entryPointRef: string,
): Record<string, unknown> | undefined {
  return files.flatMap((f) => {
    if (!/^workflows\/[^/]*\.ya?ml$/.test(f.path)) return [];
    const wf = parsedOrNull(f.text);
    return isObj(wf) && wf.name === entryPointRef ? [wf] : [];
  })[0];
}

/** Why no recipe can call this app at all: only free text rules one out. */
function entryProblem(
  files: Array<{ path: string; text: string }>,
  draft: { entryPointRef: string; recipe?: DraftRecipe },
): string | undefined {
  const entry = entryWorkflow(files, draft.entryPointRef);
  if (!entry) return undefined;
  const required = isObj(entry.inputs) && Array.isArray(entry.inputs.required)
    ? entry.inputs.required
    : [];
  const pieces = draft.recipe?.pieces;
  const free = pieces && required.find((r) => !pieces.includes(String(r)));
  return free
    ? `The input "${free}" is required and the recipe has no piece for it: a recipe can only pass a number, a repo or one word taken from the phrase.`
    : undefined;
}

/** How to give an entry point with several steps a recipe, if it has them. */
function severalSteps(
  files: Array<{ path: string; text: string }>,
  entryPointRef: string,
): string | undefined {
  const entry = entryWorkflow(files, entryPointRef);
  const steps = entry ? stepsOf(entry).length : 0;
  return steps > 1
    ? `The entry point ${entryPointRef} has ${steps} steps, and a recipe calls one method: give the app one method that does them all by calling the code directly, or, if that can't answer in ${RECIPE_BUDGET_SECONDS} s, one that answers from the latest stored result, and point a recipe at it, as the app's CLAUDE.md says.`
    : undefined;
}

/**
 * The `source` for a recipe's tag: what the engine keeps. It takes https, or http
 * on this machine, with no user name or password, and a spec may hold other http
 * links, so those stay out of the tag rather than being reported on every sync.
 */
export function recipeSource(
  source: { url: string; version?: number } | undefined,
): { url: string; version?: number } | undefined {
  if (!source) return undefined;
  const url = new URL(source.url);
  const fits = !url.username && !url.password &&
    (url.protocol === "https:" ||
      ["localhost", "127.0.0.1"].includes(url.hostname));
  if (!fits) return undefined;
  return {
    url: source.url,
    ...(source.version === undefined ? {} : { version: source.version }),
  };
}

/**
 * Whether the manifest says the app only reads: the engine's own rule, so
 * `effects-read` without `effects-write`, and anything unclear is a write.
 */
export function onlyReads(
  files: Array<{ path: string; text: string }>,
): boolean {
  const manifest = parsedOrNull(
    files.find((f) => f.path === "manifest.yaml")?.text ?? "",
  );
  const labels = isObj(manifest) ? manifest.labels : undefined;
  return Array.isArray(labels) && labels.includes("effects-read") &&
    !labels.includes("effects-write");
}

/**
 * What the repo's recipes come to, against the phrases agreed for the app. A
 * recipe's own faults are blockers. No recipe is a blocker too, unless the app
 * can't be called by one, because a required input is free text: then `none`
 * says why.
 */
export function assessRecipe(
  files: Array<{ path: string; text: string }>,
  draft: { entryPointRef: string; recipe?: DraftRecipe },
): RecipeFindings {
  const agreed = [
    ...new Set([
      ...(draft.recipe?.examples ?? []),
      ...(latestOutcome(files)?.phrases ?? []),
    ]),
  ];
  const phrases = agreed.slice(0, MAX_EXAMPLES);
  const skipped = agreed.length - phrases.length;
  const empty: RecipeFindings = { phrases, recipes: [], blockers: [], skipped };
  if (phrases.length === 0) return empty;

  const blockers: string[] = [];
  const recipes: Array<Record<string, unknown>> = [];
  const shipped = new Set<string>();
  for (const f of files) {
    if (!/^workflows\/[^/]*\.ya?ml$/.test(f.path)) continue;
    const wf = parsedOrNull(f.text);
    if (wf === null) {
      if (f.text.includes("puddlerouterRecipe")) {
        blockers.push(`${f.path} is not valid YAML.`);
      }
      continue;
    }
    if (!isObj(wf) || !isObj(wf.tags) || !("puddlerouterRecipe" in wf.tags)) {
      continue;
    }
    shipped.add(f.path.slice("workflows/".length));
    const read = recipeFromWorkflow(wf);
    if ("error" in read) {
      blockers.push(`${f.path}: ${read.error}.`);
      continue;
    }
    recipes.push(read.recipe);
    const each = read.recipe.each;
    if (isObj(each) && each.line === DRAFT_LINE) {
      blockers.push(
        `${f.path}: each.line is still the draft's ${DRAFT_LINE}: set it to what one line of the answer shows, using the fields of each item.`,
      );
    }
  }

  if (shipped.size === 0) {
    const why = entryProblem(files, draft);
    if (why) return { ...empty, none: why };
    const steps = severalSteps(files, draft.entryPointRef);
    if (steps) return { ...empty, blockers: [...blockers, steps] };
    const file = draft.recipe?.workflow;
    const reason = draft.recipe?.reason;
    return {
      ...empty,
      blockers: [
        ...blockers,
        reason
          ? `No recipe answers the phrases agreed for this app: ${reason} Write one by hand, as the app's CLAUDE.md says, or change the spec.`
          : `No recipe answers the phrases agreed for this app: ${
            file ? `put ${file} back` : "render the draft again or write one"
          }, list it in the manifest and label the manifest ${RECIPE_LABEL}.`,
      ],
    };
  }

  const manifest = parsedOrNull(
    files.find((f) => f.path === "manifest.yaml")?.text ?? "",
  );
  const listed = isObj(manifest) && Array.isArray(manifest.workflows)
    ? manifest.workflows
    : [];
  for (const file of shipped) {
    if (!listed.includes(file)) {
      blockers.push(`The manifest's workflows: doesn't list ${file}.`);
    }
  }
  const labels = isObj(manifest) && Array.isArray(manifest.labels)
    ? manifest.labels
    : [];
  if (!labels.includes(RECIPE_LABEL)) {
    blockers.push(`The manifest's labels: doesn't have ${RECIPE_LABEL}.`);
  }
  return { phrases, recipes, blockers, skipped };
}
