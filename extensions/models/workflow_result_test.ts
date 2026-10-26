/**
 * Tests for workflows/workflow-result.yaml: it writes a build-result/v1 from
 * its inputs and this model's own draft, and reads no other app's data.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/workflow_result_test.ts
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
  new URL("../../workflows/workflow-result.yaml", import.meta.url),
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

Deno.test("result workflow: is named for the package", () => {
  assertEquals(workflow.name, "@puddleworks/puddleworks-factory-result");
});

Deno.test("result workflow: the repository, pull request and out file may be left blank", () => {
  assertEquals(workflow.inputs.required.sort(), ["buildRef", "name"]);
  assertEquals(workflow.inputs.properties.repository.default, "");
  assertEquals(workflow.inputs.properties.pullRequest.default, "");
  assertEquals(workflow.inputs.properties.out.default, "");
});

Deno.test("result workflow: one step passes every input to result", () => {
  assertEquals(steps.length, 1);
  const [step] = steps;
  assertEquals(step.task.type, "model_method");
  assertEquals(step.task.modelIdOrName, "puddleworks-factory");
  assertEquals(step.task.methodName, "result");
  const args = Object.keys(model.methods.result.arguments.shape).sort();
  assertEquals(Object.keys(workflow.inputs.properties).sort(), args);
  assertEquals(Object.keys(step.task.inputs ?? {}).sort(), args);
  for (const [name, value] of Object.entries(step.task.inputs ?? {})) {
    assertEquals(value, `\${{ inputs.${name} }}`);
  }
});

Deno.test("result workflow: reads no stored data and mentions no request", () => {
  assertEquals(/\bdata\.(latest|query)\(/.test(TEXT), false);
  assertEquals(/request/i.test(TEXT.replace(/pull ?request/gi, "")), false);
});
