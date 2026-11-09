/**
 * Instance names the draft model keeps for its own resources.
 *
 * The draft resource is stored under the bare app name. The others are stored
 * under a prefix plus the app name, so an app whose name starts with one of
 * these prefixes would share an instance name with another app's resource,
 * and each would overwrite the other.
 *
 * @module
 */

import { safeText } from "./redact.ts";

/** The prefix each prefixed resource's instance name starts with. */
export const RESOURCE_PREFIX = {
  prefill: "prefill-",
  buildResult: "build-result-",
  visibility: "visibility-",
  readiness: "readiness-",
  planReview: "plan-review-",
} as const;

/** The reserved prefix an app name starts with, or undefined if none. */
export function reservedPrefix(name: string): string | undefined {
  return Object.values(RESOURCE_PREFIX).find((p) => name.startsWith(p));
}

/** Why an app name can't be used, in plain language. */
export function reservedNameProblem(name: string, prefix: string): string {
  return `App name "${name}" starts with "${prefix}", which the Factory keeps ` +
    "for its own records; pick another name.";
}

/**
 * The ids of the recipes `@puddleworks/recipes` ships with. An app's recipe
 * takes the app's name as its id, and the engine drops a recipe whose id is
 * already taken, so an app with one of these names could never be reached.
 * Kept in step with `RECIPES` in puddlerecipes `extensions/models/_lib/recipes.ts`.
 */
export const BUILT_IN_RECIPE_IDS = ["git-status", "git-log", "git-branch"];

/** Why an app name can't be used because a built-in recipe has it, or undefined. */
export function builtInRecipeProblem(name: string): string | undefined {
  if (!BUILT_IN_RECIPE_IDS.includes(name)) return undefined;
  return `App name "${name}" is the id of a recipe the recipe engine ships ` +
    "with, so it would drop this app's recipe; pick another name.";
}

/**
 * Why a name can't be used because it reads as a secret, or undefined if it
 * doesn't. Every record hides text that looks like a token as "(hidden)", so
 * a name like `sk-…` or `xoxb-…` would be lost from every record that names it.
 */
export function secretNameProblem(
  what: string,
  name: string,
): string | undefined {
  if (safeText(name) === name) return undefined;
  return `${what} reads as a secret, so every record would hide it; ` +
    "pick another name.";
}
