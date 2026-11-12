/**
 * Tests for workflows/workflow-round.yaml: it asks for a review round of the
 * app this model drafted, and reads no other app's data.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/workflow_readiness_test.ts
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
  new URL("../../workflows/workflow-round.yaml", import.meta.url),
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

Deno.test("round workflow: is named for the package", () => {
  assertEquals(workflow.name, "@puddleworks/puddleworks-factory-round");
});

Deno.test("round workflow: needs only the name; a round past the limit needs grant", () => {
  assertEquals(workflow.inputs.required, ["name"]);
  assertEquals(workflow.inputs.properties.grant, {
    ...workflow.inputs.properties.grant,
    type: "boolean",
    default: false,
  });
  assertEquals(workflow.inputs.properties.targetDir.default, "");
});

Deno.test("round workflow: one step passes every input to readiness", () => {
  assertEquals(steps.length, 1);
  const [step] = steps;
  assertEquals(step.task.type, "model_method");
  assertEquals(step.task.modelIdOrName, "puddleworks-factory");
  assertEquals(step.task.methodName, "round");
  const args = Object.keys(model.methods.round.arguments.shape).sort();
  assertEquals(Object.keys(workflow.inputs.properties).sort(), args);
  assertEquals(Object.keys(step.task.inputs ?? {}).sort(), args);
  for (const [name, value] of Object.entries(step.task.inputs ?? {})) {
    assertEquals(value, `\${{ inputs.${name} }}`);
  }
});

Deno.test("round workflow: reads no stored data", () => {
  assertEquals(/\bdata\.(latest|query)\(/.test(TEXT), false);
});
