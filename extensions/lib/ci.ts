/**
 * An app's `.github/workflows/ci.yml`, read as GitHub reads it.
 *
 * @module
 */
import { parse as parseYaml } from "jsr:@std/yaml@1.0.12";

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;

/**
 * The value a job in ci.yml gives one input (`with:`) of the workflow it
 * calls, such as the publish job's `tests` or `accepted-warnings`: the first
 * job that gives it a string. Empty when none does, the value is not a
 * string (a list, say), or ci.yml is missing or not YAML.
 */
export function ciInput(ciYml: string | null, input: string): string {
  let jobs: Record<string, unknown> | null;
  try {
    jobs = record(record(parseYaml(ciYml ?? ""))?.jobs);
  } catch {
    return "";
  }
  for (const job of Object.values(jobs ?? {})) {
    const value = record(record(job)?.with)?.[input];
    if (typeof value === "string") return value;
  }
  return "";
}
