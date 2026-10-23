/**
 * Tests for workflows/workflow-prefill.yaml: it writes a starter app spec from
 * an outcome spec input, and reads no other app's data.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/workflow_prefill_test.ts
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
  new URL("../../workflows/workflow-prefill.yaml", import.meta.url),
);
const workflow = parseYaml(TEXT) as {
  name: string;
  inputs: {
    properties: Record<string, { default?: unknown }>;
    required: string[];
  };
  jobs: { steps: Step[] }[];
};
const steps = workflow.jobs.flatMap((j) => j.steps);

Deno.test("prefill workflow: is named for the package", () => {
  assertEquals(workflow.name, "@puddleworks/puddleworks-factory-prefill");
});

Deno.test("prefill workflow: takes an outcome spec and where to write the starter", () => {
  assertEquals(workflow.inputs.required.sort(), ["out", "outcomeSpec"]);
  assertEquals(workflow.inputs.properties.overwrite.default, false);
});

Deno.test("prefill workflow: one step passes every input to prefill", () => {
  assertEquals(steps.length, 1);
  const [step] = steps;
  assertEquals(step.task.type, "model_method");
  assertEquals(step.task.modelIdOrName, "puddleworks-factory");
  assertEquals(step.task.methodName, "prefill");
  const args = Object.keys(model.methods.prefill.arguments.shape).sort();
  assertEquals(Object.keys(workflow.inputs.properties).sort(), args);
  assertEquals(Object.keys(step.task.inputs ?? {}).sort(), args);
  for (const [name, value] of Object.entries(step.task.inputs ?? {})) {
    assertEquals(value, `\${{ inputs.${name} }}`);
  }
});

Deno.test("prefill workflow: reads no stored data", () => {
  assertEquals(/\bdata\.(latest|query)\(/.test(TEXT), false);
});
