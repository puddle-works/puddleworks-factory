/**
 * Tests for workflows/workflow-visibility.yaml: it checks the app's repo with
 * this model's own draft, and reads no other app's data.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/workflow_visibility_test.ts
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
  new URL("../../workflows/workflow-visibility.yaml", import.meta.url),
);
const workflow = parseYaml(TEXT) as {
  name: string;
  inputs: {
    properties: Record<string, { type?: string; default?: unknown }>;
    required: string[];
  };
  jobs: { steps: Step[] }[];
};
const steps = workflow.jobs.flatMap((j) => j.steps);

Deno.test("visibility workflow: is named for the package", () => {
  assertEquals(workflow.name, "@puddleworks/puddleworks-factory-visibility");
});

Deno.test("visibility workflow: needs the name, quality and repo visibility", () => {
  assertEquals(workflow.inputs.required.sort(), [
    "name",
    "quality",
    "repoVisibility",
  ]);
  assertEquals(workflow.inputs.properties.quality.type, "integer");
  assertEquals(workflow.inputs.properties.targetDir.default, "");
});

Deno.test("visibility workflow: one step passes every input to visibility", () => {
  assertEquals(steps.length, 1);
  const [step] = steps;
  assertEquals(step.task.type, "model_method");
  assertEquals(step.task.modelIdOrName, "puddleworks-factory");
  assertEquals(step.task.methodName, "visibility");
  const args = Object.keys(model.methods.visibility.arguments.shape).sort();
  assertEquals(Object.keys(workflow.inputs.properties).sort(), args);
  assertEquals(Object.keys(step.task.inputs ?? {}).sort(), args);
  for (const [name, value] of Object.entries(step.task.inputs ?? {})) {
    assertEquals(value, `\${{ inputs.${name} }}`);
  }
});

Deno.test("visibility workflow: reads no stored data", () => {
  assertEquals(/\bdata\.(latest|query)\(/.test(TEXT), false);
});
