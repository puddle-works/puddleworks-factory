/**
 * What changed between two agreed versions of one request's outcome spec, and
 * the change plan the builder works from to take an existing app to the new
 * version. Nothing here does I/O.
 *
 * @module
 */
import type { OutcomeSpec } from "../contracts/outcome_spec_v1.ts";

/** One change between the versions, in the section it is in. */
export interface SpecChange {
  section: string;
  kind: "added" | "removed" | "changed";
  /** The new text, or the removed text for a removal. */
  text: string;
  /** The text it replaces, for a change. */
  was?: string;
}

/** Added and removed items of a list, in the new and old order. */
function listChanges(
  section: string,
  was: string[],
  now: string[],
): SpecChange[] {
  return [
    ...now.filter((t) => !was.includes(t)).map((text) => ({
      section,
      kind: "added" as const,
      text,
    })),
    ...was.filter((t) => !now.includes(t)).map((text) => ({
      section,
      kind: "removed" as const,
      text,
    })),
  ];
}

/** Every change from the old version's specification to the new one's. */
export function specChanges(old: OutcomeSpec, now: OutcomeSpec): SpecChange[] {
  const a = old.specification;
  const b = now.specification;
  const out: SpecChange[] = [];
  for (const key of ["problemStatement", "desiredOutcome"] as const) {
    if (a[key] !== b[key]) {
      out.push({ section: key, kind: "changed", text: b[key], was: a[key] });
    }
  }
  out.push(...listChanges("scope.in", a.scope.in, b.scope.in));
  out.push(...listChanges("scope.out", a.scope.out, b.scope.out));
  out.push(...listChanges("constraints", a.constraints, b.constraints));
  out.push(...listChanges("assumptions", a.assumptions, b.assumptions));
  // Criteria keep their id across versions, so a reworded one is a change.
  const before = new Map(a.acceptanceCriteria.map((c) => [c.id, c.text]));
  const after = new Map(b.acceptanceCriteria.map((c) => [c.id, c.text]));
  for (const [id, text] of after) {
    const was = before.get(id);
    if (was === undefined) {
      out.push({
        section: "acceptanceCriteria",
        kind: "added",
        text: `${id}: ${text}`,
      });
    } else if (was !== text) {
      out.push({
        section: "acceptanceCriteria",
        kind: "changed",
        text: `${id}: ${text}`,
        was: `${id}: ${was}`,
      });
    }
  }
  for (const [id, text] of before) {
    if (!after.has(id)) {
      out.push({
        section: "acceptanceCriteria",
        kind: "removed",
        text: `${id}: ${text}`,
      });
    }
  }
  out.push(...listChanges(
    "recipe.examples",
    (a.recipe?.examples ?? []).map((e) => e.phrase),
    (b.recipe?.examples ?? []).map((e) => e.phrase),
  ));
  return out;
}

/** What each kind of change asks of the builder. */
const WHAT_TO_DO: Record<string, string> = {
  problemStatement:
    "Check the app's CLAUDE.md purpose and README still say what it is for.",
  desiredOutcome:
    "Check specification.purpose and output in spec/app-spec.json, and the app's CLAUDE.md and README, still match.",
  "scope.in":
    "New work in scope needs code and tests; work taken out of scope needs its code and tests removed.",
  "scope.out":
    "spec/app-spec.json's outOfScope now follows it. Anything it lists must not be in the app; anything it no longer lists may now be built.",
  constraints:
    "Check the code meets each constraint, and add tests where one can be tested.",
  assumptions: "Check the code doesn't rely on an assumption that was removed.",
  acceptanceCriteria:
    "Write a test (or a manual check) for each added or changed criterion first, and drop the tests of a removed one. spec/acceptance.json is rewritten in review.",
  "recipe.examples":
    "spec/app-spec.json's recipe now follows it. Widen or narrow the recipe workflow's pattern; readiness checks each phrase again.",
};

/** The change plan, as Markdown, that the builder works from. */
export function changePlan(
  name: string,
  old: OutcomeSpec,
  now: OutcomeSpec,
  changes: SpecChange[],
): string {
  const from = old.specification.version;
  const to = now.specification.version;
  const lines = [
    `# Change plan: ${name}, spec version ${from} to ${to}`,
    "",
    `Request: ${now.request.url}`,
    "",
  ];
  const why = now.specification.changeSummary?.trim();
  lines.push(`Why it changed: ${why || "(the export doesn't say)"}`, "");
  if (!changes.length) {
    lines.push(
      "Nothing in the specification changed. Only the version and hash the app meets do.",
    );
    return lines.join("\n") + "\n";
  }
  lines.push("## What changed", "");
  for (const c of changes) {
    lines.push(
      c.kind === "changed"
        ? `- ${c.section}, changed: ${c.text} (was: ${c.was})`
        : `- ${c.section}, ${c.kind}: ${c.text}`,
    );
  }
  lines.push("", "## What it affects", "");
  for (const section of [...new Set(changes.map((c) => c.section))]) {
    lines.push(`- ${section}: ${WHAT_TO_DO[section]}`);
  }
  lines.push(
    "",
    "## Every revision",
    "",
    "- Agree with the user any change to inputs, settings, output or delivery in spec/app-spec.json; do not guess.",
    "- Update the app's section of CLAUDE.md (purpose, inputs, settings, out of scope) and the README to match.",
    "- Bump the manifest's version.",
    "- Change the finished code only where this plan says; keep everything else as it is.",
  );
  return lines.join("\n") + "\n";
}
