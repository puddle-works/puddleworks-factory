/**
 * Tests for what changed between two versions of an outcome spec, and the
 * change plan built from it.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/revision_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  type OutcomeSpec,
  parseOutcomeSpec,
} from "../contracts/outcome_spec_v1.ts";
import { changePlan, specChanges } from "./revision.ts";

const V1 = (() => {
  const p = parseOutcomeSpec(JSON.parse(Deno.readTextFileSync(
    new URL(
      "../../docs/contracts/outcome-spec.v1.example.json",
      import.meta.url,
    ),
  )));
  if (!p.ok) throw new Error(p.problems.join("; "));
  return p.spec;
})();

function v2(edit: (s: OutcomeSpec["specification"]) => void): OutcomeSpec {
  const next = structuredClone(V1);
  next.specification.version = 2;
  edit(next.specification);
  return next;
}

Deno.test("revision: the same spec at a new version has no changes", () => {
  assertEquals(specChanges(V1, v2(() => {})), []);
  assertStringIncludes(
    changePlan("app", V1, v2(() => {}), []),
    "Nothing in the specification changed",
  );
});

Deno.test("revision: an item moved into scope is added there and removed from out", () => {
  const now = v2((s) => {
    s.scope.out = ["Prices and invoices"];
    s.scope.in.push("Sending orders to suppliers");
  });
  assertEquals(specChanges(V1, now), [
    { section: "scope.in", kind: "added", text: "Sending orders to suppliers" },
    {
      section: "scope.out",
      kind: "removed",
      text: "Sending orders to suppliers",
    },
  ]);
});

Deno.test("revision: a criterion keeps its id, so rewording it is a change", () => {
  const now = v2((s) => {
    s.acceptanceCriteria[0].text = "A count can be entered in under 20 seconds";
    s.acceptanceCriteria = s.acceptanceCriteria.filter((c) => c.id !== "AC3");
    s.acceptanceCriteria.push({ id: "AC4", text: "Two stockrooms" });
  });
  const changes = specChanges(V1, now);
  assertEquals(changes.map((c) => [c.kind, c.text.split(":")[0]]), [
    ["changed", "AC1"],
    ["added", "AC4"],
    ["removed", "AC3"],
  ]);
  assertEquals(
    changes[0].was,
    "AC1: A count for one item can be entered in under 30 seconds",
  );
});

Deno.test("revision: the plan quotes the reason and says what each change affects", () => {
  const now = v2((s) => {
    s.changeSummary = "The owner wants orders sent too.";
    s.recipe!.examples.push({
      phrase: "what do we order",
      answer: "The list.",
    });
  });
  const plan = changePlan("stock", V1, now, specChanges(V1, now));
  assertStringIncludes(plan, "spec version 1 to 2");
  assertStringIncludes(
    plan,
    "Why it changed: The owner wants orders sent too.",
  );
  assertStringIncludes(plan, "- recipe.examples, added: what do we order");
  assertStringIncludes(plan, "Widen or narrow the recipe workflow's pattern");
  assertEquals(plan.includes("- scope.in:"), false);
});

Deno.test("revision: a missing reason is said, not left blank", () => {
  assertStringIncludes(
    changePlan("stock", V1, v2(() => {}), []),
    "Why it changed: (the export doesn't say)",
  );
});
