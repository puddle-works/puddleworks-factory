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

/** The prefix each prefixed resource's instance name starts with. */
export const RESOURCE_PREFIX = {
  prefill: "prefill-",
  buildResult: "build-result-",
  visibility: "visibility-",
  readiness: "readiness-",
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
