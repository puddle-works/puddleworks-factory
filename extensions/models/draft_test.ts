/**
 * Tests for the @mesgme/puddleworks-factory/draft model type.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_test.ts
 *
 * The acceptance tests write a rendered draft to a temp directory and run
 * `deno check` and `deno test` on it, so they need --allow-run.
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import { stub } from "jsr:@std/testing@1/mock";
import { parse as parseYaml } from "jsr:@std/yaml@1";
import { io, model, renderDraft } from "./draft.ts";
import type { AppSpec } from "../contracts/app_spec_v1.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);

/** The documented example: a spec with no request behind it. */
const OBSIDIAN: AppSpec = JSON.parse(EXAMPLE_TEXT);
const OBSIDIAN_SPEC = OBSIDIAN.specification;

/** Every input type, a required input, a secret, and text that needs escaping. */
const AWKWARD: AppSpec = {
  apiVersion: "puddleworks.dev/app-spec/v1",
  kind: "AppSpec",
  name: "ticket-filer",
  title: 'File a "ticket" */ with ${{ odd }} text',
  specification: {
    purpose: 'Files one ticket. Says "hi" and closes */ comments.\nTwo lines.',
    inputs: [
      {
        name: "summary",
        type: "string",
        description: 'The "summary"',
        required: true,
      },
      {
        name: "priority",
        type: "integer",
        description: "1 to 5",
        required: true,
      },
      {
        name: "weight",
        type: "number",
        description: "Weight",
        required: false,
        default: 0.5,
      },
      {
        name: "urgent",
        type: "boolean",
        description: "Urgent?",
        required: false,
        default: false,
      },
      {
        name: "label",
        type: "string",
        description: "Label",
        required: false,
        default: 'it\'s "x"',
      },
    ],
    output: "The new ticket's id.",
    outOfScope: ["Closing tickets */"],
    settings: [
      { name: "apiToken", description: "Ticket API token", sensitive: true },
      { name: "baseUrl", description: "Ticket API base URL", sensitive: false },
    ],
    recordedBy: "bob@example.com",
    recordedAt: "2026-10-06T10:00:00.000Z",
  },
  delivery: { method: "packaged_script" },
};

const FIXED = {
  now: new Date("2026-10-06T12:00:00Z"),
  uuid: "00000000-0000-4000-8000-000000000111",
};

type Opts = { typeScope?: string; visibility?: "public" | "private" };

function fileMap(spec: AppSpec, opts: Opts = {}): Map<string, string> {
  return new Map(
    renderDraft(spec, { ...FIXED, ...opts }).map((f) => [f.path, f.content]),
  );
}

// deno-lint-ignore no-explicit-any
function workflowOf(spec: AppSpec, path: string, opts: Opts = {}): any {
  return parseYaml(fileMap(spec, opts).get(path)!);
}

// ---------------------------------------------------------------------------
// renderDraft — pure rendering
// ---------------------------------------------------------------------------

Deno.test("render: produces the extension, its tests, the workflow and the puddle docs", () => {
  assertEquals([...fileMap(OBSIDIAN).keys()].sort(), [
    "extensions/models/obsidian_puddle_scanner.ts",
    "extensions/models/obsidian_puddle_scanner_test.ts",
    "puddles/obsidian-puddle-scanner/CLAUDE.md",
    "puddles/obsidian-puddle-scanner/README.md",
    "puddles/obsidian-puddle-scanner/manifest.yaml",
    "workflows/workflow-obsidian-scan.yaml",
  ]);
});

Deno.test("render: workflow is named <collective>/<entry point> so the package can carry it", () => {
  const wf = workflowOf(OBSIDIAN, "workflows/workflow-obsidian-scan.yaml");
  assertEquals(wf.name, "@puddleworks/obsidian-scan");
  assertEquals(wf.id, FIXED.uuid);
  assertEquals(wf.tags, { puddle: "true" });
});

Deno.test("render: without an entry point the workflow takes the app name", () => {
  const wf = workflowOf(AWKWARD, "workflows/workflow-ticket-filer.yaml");
  assertEquals(wf.name, "@puddleworks/ticket-filer");
});

Deno.test("render: an entry point that already carries the collective is kept", () => {
  const input = {
    ...OBSIDIAN,
    delivery: {
      method: "workflow_form" as const,
      entryPointRef: "@puddleworks/obsidian-scan",
    },
  };
  const wf = workflowOf(input, "workflows/workflow-obsidian-scan.yaml");
  assertEquals(wf.name, "@puddleworks/obsidian-scan");
});

Deno.test("render: the workflow takes the type scope as its collective", () => {
  const wf = workflowOf(OBSIDIAN, "workflows/workflow-obsidian-scan.yaml", {
    typeScope: "@acme",
  });
  assertEquals(wf.name, "@acme/obsidian-scan");
});

Deno.test("render: refuses an entry point in another collective", () => {
  assertThrows(
    () =>
      renderDraft({
        ...OBSIDIAN,
        delivery: {
          method: "workflow_form",
          entryPointRef: "@other/obsidian-scan",
        },
      }, FIXED),
    Error,
    "@other/obsidian-scan",
  );
});

Deno.test("render: workflow inputs match the specification inputs exactly", () => {
  for (const input of [OBSIDIAN, AWKWARD]) {
    const ref = input.delivery.entryPointRef ?? input.name;
    const wf = workflowOf(input, `workflows/workflow-${ref}.yaml`);
    const spec = input.specification.inputs;
    assertEquals(Object.keys(wf.inputs.properties), spec.map((i) => i.name));
    for (const i of spec) {
      const prop = wf.inputs.properties[i.name];
      assertEquals(prop.type, i.type);
      assertEquals(prop.description, i.description);
      assertEquals(prop.default, i.default);
    }
    assertEquals(
      wf.inputs.required,
      spec.filter((i) => i.required).map((i) => i.name),
    );
  }
});

Deno.test("render: the workflow passes every input to the model's run method", () => {
  const wf = workflowOf(AWKWARD, "workflows/workflow-ticket-filer.yaml");
  const steps = wf.jobs[0].steps;
  assertEquals(steps.length, 1);
  assertEquals(steps[0].task.type, "model_method");
  // The instance is <name>-model; Distribution reads it from the workflow.
  assertEquals(steps[0].task.modelIdOrName, "ticket-filer-model");
  assertEquals(steps[0].task.methodName, "run");
  assertEquals(steps[0].task.inputs, {
    summary: "${{ inputs.summary }}",
    priority: "${{ inputs.priority }}",
    weight: "${{ inputs.weight }}",
    urgent: "${{ inputs.urgent }}",
    label: "${{ inputs.label }}",
  });
});

Deno.test("render: a workflow with no inputs still lists an empty required array", () => {
  const input = {
    ...OBSIDIAN,
    specification: { ...OBSIDIAN_SPEC, inputs: [] },
  };
  const wf = workflowOf(input, "workflows/workflow-obsidian-scan.yaml");
  assertEquals(wf.inputs.properties, {});
  assertEquals(wf.inputs.required, []);
  assertEquals(wf.jobs[0].steps[0].task.inputs, {});
});

Deno.test("render: the publish manifest points at the extension source", () => {
  const manifest = parseYaml(
    fileMap(OBSIDIAN).get("puddles/obsidian-puddle-scanner/manifest.yaml")!,
    // deno-lint-ignore no-explicit-any
  ) as any;
  assertEquals(manifest.name, "@puddleworks/obsidian-puddle-scanner");
  assertEquals(manifest.version, "2026.10.06.1");
  // swamp refuses ".." in manifest paths; these resolve against
  // extensions/models/, workflows/ and the manifest's own folder.
  assertEquals(manifest.paths, undefined);
  assertEquals(manifest.models, ["obsidian_puddle_scanner.ts"]);
  assertEquals(manifest.workflows, ["workflow-obsidian-scan.yaml"]);
  assertEquals(manifest.additionalFiles, ["README.md"]);
});

Deno.test("render: the manifest is public by default, with no visibility line", () => {
  const manifest = parseYaml(
    fileMap(OBSIDIAN).get("puddles/obsidian-puddle-scanner/manifest.yaml")!,
    // deno-lint-ignore no-explicit-any
  ) as any;
  assertEquals(manifest.visibility, undefined);
});

Deno.test("render: visibility private is written into the manifest", () => {
  const manifest = parseYaml(
    fileMap(OBSIDIAN, { visibility: "private" }).get(
      "puddles/obsidian-puddle-scanner/manifest.yaml",
    )!,
    // deno-lint-ignore no-explicit-any
  ) as any;
  assertEquals(manifest.visibility, "private");
});

Deno.test("render: the README creates the instance the workflow runs and runs the workflow", () => {
  const readme = fileMap(OBSIDIAN).get(
    "puddles/obsidian-puddle-scanner/README.md",
  )!;
  assertStringIncludes(
    readme,
    "swamp model create @puddleworks/obsidian-puddle-scanner obsidian-puddle-scanner-model",
  );
  assertStringIncludes(readme, "swamp workflow run @puddleworks/obsidian-scan");
});

Deno.test("render: the extension declares the type, every input and every setting", () => {
  const src = fileMap(AWKWARD).get("extensions/models/ticket_filer.ts")!;
  assertStringIncludes(src, 'type: "@puddleworks/ticket-filer"');
  assertStringIncludes(src, "summary: z.string().min(1)");
  assertStringIncludes(src, "priority: z.number().int()");
  assertStringIncludes(src, "weight: z.number().default(0.5)");
  assertStringIncludes(src, "urgent: z.boolean().default(false)");
  assertStringIncludes(
    src,
    "apiToken: z.string().min(1).meta({ sensitive: true, description:",
  );
  assertStringIncludes(src, "baseUrl: z.string().min(1)");
});

// swamp's bundler rewrites every `from "npm:zod…"` in draft.ts, including
// text inside template strings, to `globalThis.__swamp_zod`. If the generated
// import is written out literally in draft.ts, drafts rendered through swamp
// stop compiling even though these unit tests (which run unbundled) pass.
Deno.test("render: draft.ts has no zod import text other than its own", async () => {
  const source = await Deno.readTextFile(
    new URL("./draft.ts", import.meta.url),
  );
  assertEquals(source.match(/from\s+["']npm:zod/g)?.length, 1);
});

// The registry catalog reads type and version from the first
// `export const model = {` in draft.ts. If the generated one comes first, the
// catalog sees `${q(n.modelType)}` and does not list
// @mesgme/puddleworks-factory/draft.
Deno.test("render: draft.ts has no model export text other than its own", async () => {
  const source = await Deno.readTextFile(
    new URL("./draft.ts", import.meta.url),
  );
  assertEquals(source.match(/export\s+const\s+model\s*=/g)?.length, 1);
});

Deno.test("render: the extension exports its model", () => {
  const src = renderDraft(OBSIDIAN, FIXED)
    .find((f) => f.path.endsWith("obsidian_puddle_scanner.ts"))!.content;
  assertStringIncludes(src, "export const model = {");
});

Deno.test("render: the extension imports zod 4", () => {
  const src = renderDraft(OBSIDIAN, FIXED)
    .find((f) => f.path.endsWith("obsidian_puddle_scanner.ts"))!.content;
  assertStringIncludes(src, 'import { z } from "npm:zod@4";');
});

Deno.test("render: the type scope can be changed", () => {
  const src = renderDraft(OBSIDIAN, { ...FIXED, typeScope: "@acme" })
    .find((f) => f.path.endsWith("obsidian_puddle_scanner.ts"))!.content;
  assertStringIncludes(src, 'type: "@acme/obsidian-puddle-scanner"');
});

Deno.test("render: CLAUDE.md lists what is out of scope", () => {
  const doc = fileMap(OBSIDIAN).get(
    "puddles/obsidian-puddle-scanner/CLAUDE.md",
  )!;
  for (const item of OBSIDIAN_SPEC.outOfScope) assertStringIncludes(doc, item);
});

Deno.test("render: the user section of the README does not mention swamp", () => {
  const readme = fileMap(OBSIDIAN).get(
    "puddles/obsidian-puddle-scanner/README.md",
  )!;
  const userPart = readme.split("## For the builder")[0];
  assertEquals(/swamp/i.test(userPart), false, userPart);
});

Deno.test("render: CLAUDE.md tells the builder where test permission flags go", () => {
  const doc = fileMap(OBSIDIAN).get(
    "puddles/obsidian-puddle-scanner/CLAUDE.md",
  )!;
  const finishing = doc.split("## Finishing the draft")[1];
  assertStringIncludes(finishing, "--allow-");
  assertStringIncludes(finishing, "README.md");
  assertStringIncludes(finishing, "Makefile");
});

Deno.test("render: the generated test file points at the README test command", () => {
  const tests = fileMap(OBSIDIAN).get(
    "extensions/models/obsidian_puddle_scanner_test.ts",
  )!;
  assertEquals(tests.includes("deno test extensions/models/"), false);
  assertStringIncludes(tests, "puddles/obsidian-puddle-scanner/README.md");
});

Deno.test("render: refuses a delivery method that has nothing to draft", () => {
  for (const method of ["external_app", "manual_process"] as const) {
    assertThrows(
      () => renderDraft({ ...OBSIDIAN, delivery: { method } }, FIXED),
      Error,
      method,
    );
  }
});

Deno.test("render: refuses a specification with problems", () => {
  const bad = {
    ...OBSIDIAN,
    specification: {
      ...OBSIDIAN_SPEC,
      inputs: [{ ...OBSIDIAN_SPEC.inputs[0], default: undefined }],
    },
  };
  assertThrows(() => renderDraft(bad, FIXED), Error, "folder");
});

Deno.test("render: refuses an app name that is not a slug", () => {
  assertThrows(
    () => renderDraft({ ...OBSIDIAN, name: "Obsidian Scanner" }, FIXED),
    Error,
    "Obsidian Scanner",
  );
});

// ---------------------------------------------------------------------------
// Acceptance — the rendered draft passes deno check and its own tests
// ---------------------------------------------------------------------------

async function writeDraft(dir: string, input: AppSpec): Promise<void> {
  for (const f of renderDraft(input, FIXED)) {
    const path = `${dir}/${f.path}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, f.content);
  }
}

async function deno(cwd: string, ...args: string[]): Promise<void> {
  const out = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout) +
    new TextDecoder().decode(out.stderr);
  assertEquals(out.code, 0, `deno ${args.join(" ")} failed:\n${text}`);
}

for (const input of [OBSIDIAN, AWKWARD]) {
  Deno.test(`acceptance: ${input.name} draft passes deno check and its own tests`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "puddle-draft-" });
    try {
      await writeDraft(dir, input);
      const base = input.name.replaceAll("-", "_");
      await deno(
        dir,
        "check",
        `extensions/models/${base}.ts`,
        `extensions/models/${base}_test.ts`,
      );
      await deno(dir, "test", `extensions/models/${base}_test.ts`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}

// A builder replaces the run stub with behaviour that needs working settings
// (a real directory, a reachable API). The generated tests must keep passing
// untouched, so they must not call the real run (issue #136).
const STUB_BODY = "  return Promise.resolve([]);\n";

for (const input of [OBSIDIAN, AWKWARD]) {
  Deno.test(`acceptance: ${input.name} generated tests still pass once run is filled in`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "puddle-draft-" });
    try {
      await writeDraft(dir, input);
      const base = input.name.replaceAll("-", "_");
      const ext = `${dir}/extensions/models/${base}.ts`;
      const src = await Deno.readTextFile(ext);
      assertStringIncludes(src, STUB_BODY);
      await Deno.writeTextFile(
        ext,
        src.replace(
          STUB_BODY,
          '  throw new Error("real behaviour needs working settings");\n',
        ),
      );
      await deno(dir, "test", `extensions/models/${base}_test.ts`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}

// ---------------------------------------------------------------------------
// render method — writes the files into the app repo checkout
// ---------------------------------------------------------------------------

function makeContext() {
  const writes: Array<
    { specName: string; name: string; data: Record<string, unknown> }
  > = [];
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { info: () => {} },
    writeResource(
      specName: string,
      name: string,
      data: Record<string, unknown>,
    ) {
      writes.push({ specName, name, data });
      return Promise.resolve({ name });
    },
    writes,
  };
}

async function appRepo(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "puddle-apps-" });
  await Deno.mkdir(`${dir}/extensions/models`, { recursive: true });
  return dir;
}

const renderArgs = (
  targetDir: string,
  overwrite = false,
  visibility: "public" | "private" = "public",
  spec = EXAMPLE_TEXT,
) => ({ spec, targetDir, overwrite, visibility });

Deno.test("method: writes every file and records them in a draft resource", async () => {
  const dir = await appRepo();
  try {
    const ctx = makeContext();
    await model.methods.render.execute(renderArgs(dir), ctx);
    const wf = await Deno.readTextFile(
      `${dir}/workflows/workflow-obsidian-scan.yaml`,
    );
    assertStringIncludes(wf, 'name: "@puddleworks/obsidian-scan"');
    assertEquals(ctx.writes.length, 1);
    assertEquals(ctx.writes[0].specName, "draft");
    assertEquals(ctx.writes[0].name, "obsidian-puddle-scanner");
    assertEquals((ctx.writes[0].data.files as string[]).length, 6);
    assertEquals(
      ctx.writes[0].data.entryPointRef,
      "@puddleworks/obsidian-scan",
    );
    assertEquals(
      ctx.writes[0].data.modelType,
      "@puddleworks/obsidian-puddle-scanner",
    );
    assertEquals(
      model.resources.draft.schema.safeParse(ctx.writes[0].data).success,
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("method: visibility private reaches the written manifest", async () => {
  const dir = await appRepo();
  try {
    await model.methods.render.execute(
      renderArgs(dir, false, "private"),
      makeContext(),
    );
    const manifest = parseYaml(
      await Deno.readTextFile(
        `${dir}/puddles/obsidian-puddle-scanner/manifest.yaml`,
      ),
      // deno-lint-ignore no-explicit-any
    ) as any;
    assertEquals(manifest.visibility, "private");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("method: refuses to overwrite an existing file and writes nothing", async () => {
  const dir = await appRepo();
  try {
    await Deno.mkdir(`${dir}/workflows`);
    await Deno.writeTextFile(
      `${dir}/workflows/workflow-obsidian-scan.yaml`,
      "mine",
    );
    const ctx = makeContext();
    await assertRejects(
      () => model.methods.render.execute(renderArgs(dir), ctx),
      Error,
      "workflows/workflow-obsidian-scan.yaml",
    );
    assertEquals(
      await Deno.readTextFile(`${dir}/workflows/workflow-obsidian-scan.yaml`),
      "mine",
    );
    await assertRejects(() =>
      Deno.stat(`${dir}/extensions/models/obsidian_puddle_scanner.ts`)
    );
    assertEquals(ctx.writes.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("method: overwrite=true replaces existing files", async () => {
  const dir = await appRepo();
  try {
    await Deno.mkdir(`${dir}/workflows`);
    await Deno.writeTextFile(
      `${dir}/workflows/workflow-obsidian-scan.yaml`,
      "mine",
    );
    await model.methods.render.execute(renderArgs(dir, true), makeContext());
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/workflows/workflow-obsidian-scan.yaml`),
      'name: "@puddleworks/obsidian-scan"',
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("method: refuses a target that is not an app repo checkout", async () => {
  const dir = await Deno.makeTempDir({ prefix: "not-apps-" });
  try {
    await assertRejects(
      () => model.methods.render.execute(renderArgs(dir), makeContext()),
      Error,
      "extensions/models",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Building from a spec that came from anywhere, with no request behind it
// ---------------------------------------------------------------------------

Deno.test("render: nothing in the draft mentions a request", () => {
  for (const [path, content] of fileMap(AWKWARD)) {
    assertEquals(/request/i.test(content), false, path);
  }
});

Deno.test("method: the spec can be a file path", async () => {
  const dir = await appRepo();
  try {
    const specPath = `${dir}/scanner.json`;
    await Deno.writeTextFile(specPath, EXAMPLE_TEXT);
    const ctx = makeContext();
    await model.methods.render.execute(
      renderArgs(dir, false, "public", specPath),
      ctx,
    );
    assertEquals(ctx.writes[0].data.specSource, specPath);
    await Deno.stat(`${dir}/workflows/workflow-obsidian-scan.yaml`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("method: the spec can be an https URL", async () => {
  const url = "https://example.com/specs/scanner.json";
  using _fetch = stub(
    io,
    "fetch",
    () => Promise.resolve(new Response(EXAMPLE_TEXT)),
  );
  const dir = await appRepo();
  try {
    const ctx = makeContext();
    await model.methods.render.execute(
      renderArgs(dir, false, "public", url),
      ctx,
    );
    assertEquals(ctx.writes[0].data.specSource, url);
    await Deno.stat(`${dir}/workflows/workflow-obsidian-scan.yaml`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("method: inline JSON is recorded as inline", async () => {
  const dir = await appRepo();
  try {
    const ctx = makeContext();
    await model.methods.render.execute(renderArgs(dir), ctx);
    assertEquals(ctx.writes[0].data.specSource, "inline");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("method: a spec that breaks the contract writes nothing", async () => {
  const dir = await appRepo();
  try {
    const ctx = makeContext();
    await assertRejects(
      () =>
        model.methods.render.execute(
          renderArgs(dir, false, "public", '{"apiVersion": "nope"}'),
          ctx,
        ),
      Error,
      "app-spec/v1",
    );
    assertEquals(ctx.writes.length, 0);
    await assertRejects(() => Deno.stat(`${dir}/workflows`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
