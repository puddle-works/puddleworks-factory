/**
 * Tests for prefilling an app spec from an agreed outcome spec.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/prefill_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { prefillAppSpec, slugFrom, type StarterSpec } from "./prefill.ts";
import { parseAppSpec } from "../contracts/app_spec_v1.ts";
import {
  type OutcomeSpec,
  parseOutcomeSpec,
} from "../contracts/outcome_spec_v1.ts";

const parsed = parseOutcomeSpec(
  JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../docs/contracts/outcome-spec.v1.example.json",
        import.meta.url,
      ),
    ),
  ),
);
if (!parsed.ok) throw new Error(parsed.problems.join("\n"));
const OUTCOME: OutcomeSpec = parsed.spec;

/** What a builder decides on top of the prefill for the example. */
function decide(spec: StarterSpec): StarterSpec {
  const s = structuredClone(spec);
  s.specification.inputs = [
    {
      name: "itemCode",
      type: "string",
      description: "Item counted",
      required: true,
    },
  ];
  s.specification.output = "The reorder list.";
  s.delivery.method = "workflow_form";
  return s;
}

Deno.test("prefill: copies what the outcome spec says", () => {
  const { spec } = prefillAppSpec(OUTCOME);
  assertEquals(spec.apiVersion, "puddleworks.dev/app-spec/v1");
  assertEquals(spec.kind, "AppSpec");
  assertEquals(spec.name, "weekly-stock-count-and-reorder-list");
  assertEquals(spec.title, "Weekly stock count and reorder list");
  assertEquals(
    spec.specification.purpose,
    OUTCOME.specification.desiredOutcome,
  );
  assertEquals(spec.specification.outOfScope, [
    "Sending orders to suppliers",
    "Prices and invoices",
  ]);
  assertEquals(spec.specification.recordedBy, "priya@example.com");
  assertEquals(spec.specification.recordedAt, "2026-10-07T08:45:00.000Z");
});

Deno.test("prefill: links back to where the spec was agreed", () => {
  const { spec } = prefillAppSpec(OUTCOME);
  assertEquals(spec.source, {
    url: OUTCOME.request.url,
    version: 1,
    specHash: OUTCOME.agreement.specHash,
  });
});

Deno.test("prefill: leaves inputs, output, settings and delivery to the builder", () => {
  const { spec, toDecide } = prefillAppSpec(OUTCOME);
  assertEquals(spec.specification.inputs, []);
  assertEquals(spec.specification.output, "");
  assertEquals(spec.specification.settings, []);
  assertEquals(spec.delivery.method, "");
  const fields = toDecide.map((t) => t.split(":")[0]);
  assertEquals(fields, [
    "name",
    "specification.purpose",
    "specification.inputs",
    "specification.output",
    "specification.settings",
    "delivery.method",
  ]);
});

Deno.test("prefill: the starter is not buildable until the builder decides", () => {
  const { spec } = prefillAppSpec(OUTCOME);
  assertEquals(parseAppSpec(spec).ok, false);
});

Deno.test("prefill: once the builder decides, it is a valid app spec that keeps the link", () => {
  const result = parseAppSpec(decide(prefillAppSpec(OUTCOME).spec));
  assertEquals(result.ok, true, JSON.stringify(result));
  if (result.ok) assertEquals(result.spec.source?.version, 1);
});

Deno.test("prefill: an agreement with no usable email or time is left to the builder", () => {
  const outcome = structuredClone(OUTCOME);
  outcome.agreement.agreedBy.email = "";
  outcome.agreement.agreedAt = "last week";
  const { spec, toDecide } = prefillAppSpec(outcome);
  assertEquals(spec.specification.recordedBy, "");
  assertEquals(spec.specification.recordedAt, "");
  const fields = toDecide.map((t) => t.split(":")[0]);
  assertEquals(fields.includes("specification.recordedBy"), true);
  assertEquals(fields.includes("specification.recordedAt"), true);
});

Deno.test("prefill: open questions and missing acceptance criteria are warned about", () => {
  const outcome = structuredClone(OUTCOME);
  outcome.openQuestions = [
    {
      question: "Which phones?",
      askedBy: "Tom Reyes",
      askedAt: "2026-10-07T08:00:00.000Z",
    },
  ];
  outcome.specification.acceptanceCriteria = [];
  const { warnings } = prefillAppSpec(outcome);
  assertEquals(warnings.length, 2);
  assertStringIncludes(warnings.join(" "), "Which phones?");
  assertStringIncludes(warnings.join(" "), "acceptance criteria");
});

Deno.test("prefill: the example has nothing to warn about", () => {
  assertEquals(prefillAppSpec(OUTCOME).warnings, []);
});

Deno.test("slug: titles become slugs the app spec accepts", () => {
  const cases: Array<[string, string]> = [
    ["Weekly stock count", "weekly-stock-count"],
    ["  Café: re-order -- list! ", "cafe-re-order-list"],
    ["2026 budget", "2026-budget"],
    [
      "A very long title that goes on and on well past forty characters",
      "a-very-long-title-that-goes-on-and-on",
    ],
    ["!!!", "app"],
  ];
  for (const [title, slug] of cases) {
    assertEquals(slugFrom(title), slug, title);
    assertEquals(/^[a-z0-9][a-z0-9-]*$/.test(slug), true, slug);
  }
});
