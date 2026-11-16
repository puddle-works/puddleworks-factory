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

/** The workflow an app's publish job calls, at any ref. */
const PUBLISH =
  /^puddle-works\/puddle-tooling\/\.github\/workflows\/publish\.yml@/;

/**
 * The value a job in ci.yml gives one input (`with:`) of the workflow it
 * calls, such as the publish job's `tests` or `accepted-warnings`: the first
 * job calling puddle-tooling's publish.yml that gives it a string, or, when
 * no job calls it, the first job that does. Empty when none does, the value
 * is not a string (a list, say), or ci.yml is missing or not YAML.
 */
export function ciInput(ciYml: string | null, input: string): string {
  let jobs: Record<string, unknown> | null;
  try {
    jobs = record(record(parseYaml(ciYml ?? ""))?.jobs);
  } catch {
    return "";
  }
  const all = Object.values(jobs ?? {}).map(record);
  const publish = all.filter((job) =>
    typeof job?.uses === "string" && PUBLISH.test(job.uses)
  );
  for (const job of publish.length ? publish : all) {
    const value = record(job?.with)?.[input];
    if (typeof value === "string") return value;
  }
  return "";
}
