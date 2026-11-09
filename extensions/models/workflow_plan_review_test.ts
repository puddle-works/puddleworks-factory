/**
 * Tests for workflows/workflow-plan-review.yaml: it checks the app's repo with
 * this model's own draft, and reads no other app's data.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/workflow_plan_review_test.ts
 *
 * @module
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parse as parseYaml } from "jsr:@std/yaml@1.0.12";
import { model } from "./draft.ts";

interface Step {
  name: string;
  task: {
    type: string;
    modelIdOrName?: string;
    methodName?: string;
    inputs?: Record<string, string>;
  };
}

const TEXT = await Deno.readTextFile(
  new URL("../../workflows/workflow-plan-review.yaml", import.meta.url),
);
const workflow = parseYaml(TEXT) as {
  name: string;
  inputs: {
    properties: Record<
      string,
      { type?: string; default?: unknown; description?: string }
    >;
    required: string[];
  };
  jobs: { steps: Step[] }[];
};
const steps = workflow.jobs.flatMap((j) => j.steps);

Deno.test("plan review workflow: is named for the package", () => {
  assertEquals(workflow.name, "@puddleworks/puddleworks-factory-plan-review");
});

Deno.test("plan review workflow: needs the name, the plan and the verdict", () => {
  assertEquals(workflow.inputs.required.sort(), ["name", "plan", "verdict"]);
  assertEquals(workflow.inputs.properties.response.default, "");
});

Deno.test("plan review workflow: one step passes every input to planReview", () => {
  assertEquals(steps.length, 1);
  const [step] = steps;
  assertEquals(step.task.type, "model_method");
  assertEquals(step.task.modelIdOrName, "puddleworks-factory");
  assertEquals(step.task.methodName, "planReview");
  const args = Object.keys(model.methods.planReview.arguments.shape).sort();
  assertEquals(Object.keys(workflow.inputs.properties).sort(), args);
  assertEquals(Object.keys(step.task.inputs ?? {}).sort(), args);
  for (const [name, value] of Object.entries(step.task.inputs ?? {})) {
    assertEquals(value, `\${{ inputs.${name} }}`);
  }
});

Deno.test("plan review workflow: reads no stored data", () => {
  assertEquals(/\bdata\.(latest|query)\(/.test(TEXT), false);
});
