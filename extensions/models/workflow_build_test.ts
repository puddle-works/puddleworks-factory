/**
 * Tests for workflows/workflow-build.yaml: it builds from a spec input alone,
 * with no other app's data behind it.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/workflow_build_test.ts
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
  new URL("../../workflows/workflow-build.yaml", import.meta.url),
);
const workflow = parseYaml(TEXT) as {
  name: string;
  inputs: { properties: Record<string, unknown>; required: string[] };
  jobs: { steps: Step[] }[];
};
const steps = workflow.jobs.flatMap((j) => j.steps);

Deno.test("build workflow: is named for the package", () => {
  assertEquals(workflow.name, "@puddleworks/puddleworks-factory-build");
});

Deno.test("build workflow: takes a spec and a target, nothing else required", () => {
  assertEquals(Object.keys(workflow.inputs.properties).sort(), [
    "overwrite",
    "spec",
    "targetDir",
    "visibility",
  ]);
  assertEquals(workflow.inputs.required.sort(), ["spec", "targetDir"]);
});

Deno.test("build workflow: one render step passes every input to the draft model", () => {
  assertEquals(steps.length, 1);
  const [render] = steps;
  assertEquals(render.task.type, "model_method");
  assertEquals(render.task.modelIdOrName, "puddleworks-factory");
  assertEquals(render.task.methodName, "render");
  const renderArgs = Object.keys(
    model.methods.render.arguments.shape,
  ).sort();
  assertEquals(Object.keys(render.task.inputs ?? {}).sort(), renderArgs);
  for (const [name, value] of Object.entries(render.task.inputs ?? {})) {
    assertEquals(value, `\${{ inputs.${name} }}`);
  }
});

Deno.test("build workflow: reads no stored data and mentions no request", () => {
  assertEquals(/\bdata\.(latest|query)\(/.test(TEXT), false);
  assertEquals(/request/i.test(TEXT), false);
});
