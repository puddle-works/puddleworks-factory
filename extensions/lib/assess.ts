/**
 * The reuse check that runs before anything is built: does an existing
 * extension already do exactly what the outcome asks? The builder searches
 * (`swamp extension search`, `swamp behavior type search`, `describe`) and
 * says, for each candidate method, which fit checks it passed. This decides
 * what that means. Nothing here does I/O.
 *
 * @module
 */
import { z } from "npm:zod@4";

/** The fit checks of puddleworks-factory#41, in its order. */
export const FIT_CHECKS = [
  "wholeJob",
  "readOnly",
  "inputs",
  "settings",
  "output",
] as const;

/** What each fit check asks, in plain words. */
export const FIT_CHECK_TEXT: Record<(typeof FIT_CHECKS)[number], string> = {
  wholeJob:
    "an existing method produces the spec's output from its inputs, with nothing out of scope added",
  readOnly: "the method is read-only",
  inputs:
    "every spec input maps to a method argument, as int, repo or word, or fixed in the step",
  settings:
    "every spec setting maps to the extension's model definition, sensitive ones by vault.get(...)",
  output:
    "the output can be shown as text with each, template and empty (for a schedule: it is what the spec's output asks for)",
};

/** Collectives whose extensions are ours: a recipe goes in their own repo. */
export const OUR_COLLECTIVES = ["@puddleworks", "@mesgme"] as const;

export const CandidateSchema = z.object({
  /** The extension package, e.g. `@webframp/github`. */
  extension: z.string().regex(/^@[\w.-]+\/[\w.-]+$/),
  /** The model type the method is on. */
  type: z.string().min(1),
  method: z.string().min(1),
  /** Each fit check, true when it passed. */
  checks: z.object(
    Object.fromEntries(FIT_CHECKS.map((c) => [c, z.boolean()])) as Record<
      (typeof FIT_CHECKS)[number],
      z.ZodBoolean
    >,
  ),
  /** What the builder saw, for the person deciding. */
  note: z.string().default(""),
});

export type Candidate = z.infer<typeof CandidateSchema>;

/** How the app would be run: a recipe answers a phrase, a schedule a timer. */
export type Delivery = "packaged_script" | "scheduled_workflow";

export const MatchSchema = z.object({
  /** An example phrasing from the spec. */
  phrase: z.string().min(1),
  /** The recipe `match` picked for it, or null when none did. */
  recipe: z.string().nullable(),
  /** The extension that recipe calls, when one was picked. */
  extension: z.string().nullable().default(null),
});

export type Match = z.infer<typeof MatchSchema>;

export const VERDICTS = [
  "done",
  "recipe-in-our-extension",
  "recipe-in-pack",
  "workflow-in-our-extension",
  "workflow-app",
  "build-functionality",
] as const;

export type Verdict = (typeof VERDICTS)[number];

/** `ours` for an extension in one of our collectives, else `external`. */
export function ownerOf(
  extension: string,
  ours: readonly string[] = OUR_COLLECTIVES,
): "ours" | "external" {
  const scope = extension.slice(0, extension.indexOf("/"));
  return ours.includes(scope) ? "ours" : "external";
}

/** The checks a candidate failed. A schedule doesn't need read-only. */
export function failedChecks(
  candidate: Candidate,
  delivery: Delivery,
): string[] {
  return FIT_CHECKS.filter((c) =>
    !(c === "readOnly" && delivery === "scheduled_workflow") &&
    !candidate.checks[c]
  );
}

export interface Assessment {
  verdict: Verdict;
  /** The candidate the verdict uses, when it uses one. */
  chosen: { extension: string; type: string; method: string } | null;
  candidates: Array<
    Candidate & { owner: "ours" | "external"; fits: boolean; failed: string[] }
  >;
  /** What `match` picked for each example phrasing. */
  matches: Match[];
  /** Why this verdict, in one sentence. */
  reason: string;
}

/**
 * The verdict: done when one existing recipe answers every example phrasing;
 * otherwise an exact fit in our own extension first, then an external one;
 * with none, build it.
 */
export function assess(
  candidates: Candidate[],
  delivery: Delivery,
  matches: Match[] = [],
  ours: readonly string[] = OUR_COLLECTIVES,
): Assessment {
  const rows = candidates.map((c) => {
    const failed = failedChecks(c, delivery);
    return {
      ...c,
      owner: ownerOf(c.extension, ours),
      fits: !failed.length,
      failed,
    };
  });
  const recipes = [...new Set(matches.map((m) => m.recipe))];
  if (
    delivery === "packaged_script" && recipes.length === 1 &&
    recipes[0] !== null
  ) {
    const extension = matches[0].extension;
    return {
      verdict: "done",
      chosen: null,
      candidates: rows,
      matches,
      reason: `The recipe ${recipes[0]}${
        extension ? ` (${extension})` : ""
      } already answers every example phrasing, so build nothing.`,
    };
  }
  const fit = rows.find((r) => r.fits && r.owner === "ours") ??
    rows.find((r) => r.fits);
  if (!fit) {
    return {
      verdict: "build-functionality",
      chosen: null,
      candidates: rows,
      matches,
      reason: rows.length
        ? `None of the ${rows.length} candidates fits exactly, so build it.`
        : "No existing extension was found, so build it.",
    };
  }
  const scheduled = delivery === "scheduled_workflow";
  const verdict: Verdict = fit.owner === "ours"
    ? scheduled ? "workflow-in-our-extension" : "recipe-in-our-extension"
    : scheduled
    ? "workflow-app"
    : "recipe-in-pack";
  const what = scheduled ? "a scheduled workflow" : "a recipe";
  const where = fit.owner === "ours"
    ? `in ${fit.extension}'s own repo`
    : scheduled
    ? "in a new app repo that holds only the workflow"
    : "in the external recipes pack";
  return {
    verdict,
    chosen: { extension: fit.extension, type: fit.type, method: fit.method },
    candidates: rows,
    matches,
    reason:
      `${fit.extension} ${fit.method} fits exactly, so write ${what} ${where}.`,
  };
}
