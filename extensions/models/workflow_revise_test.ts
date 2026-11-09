/**
 * Tests for workflows/workflow-revise.yaml: it checks the app's repo with
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
  new URL("../../workflows/workflow-revise.yaml", import.meta.url),
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

Deno.test("revise workflow: is named for the package", () => {
  assertEquals(workflow.name, "@puddleworks/puddleworks-factory-revise");
});

Deno.test("revise workflow: needs the name and the outcome spec", () => {
  assertEquals(workflow.inputs.required.sort(), ["name", "outcomeSpec"]);
  assertEquals(workflow.inputs.properties.targetDir.default, "");
});

Deno.test("revise workflow: one step passes every input to revise", () => {
  assertEquals(steps.length, 1);
  const [step] = steps;
  assertEquals(step.task.type, "model_method");
  assertEquals(step.task.modelIdOrName, "puddleworks-factory");
  assertEquals(step.task.methodName, "revise");
  const args = Object.keys(model.methods.revise.arguments.shape).sort();
  assertEquals(Object.keys(workflow.inputs.properties).sort(), args);
  assertEquals(Object.keys(step.task.inputs ?? {}).sort(), args);
  for (const [name, value] of Object.entries(step.task.inputs ?? {})) {
    assertEquals(value, `\${{ inputs.${name} }}`);
  }
});

Deno.test("revise workflow: reads no stored data", () => {
  assertEquals(/\bdata\.(latest|query)\(/.test(TEXT), false);
});
