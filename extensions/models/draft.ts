/**
 * @puddleworks/puddleworks-factory/draft — turn an app spec into a first draft of
 * the app.
 *
 * `prefill` reads an agreed `puddleworks.dev/outcome-spec/v1` and writes a
 * starter app spec for the builder to finish (extensions/lib/prefill.ts).
 *
 * `render` reads a `puddleworks.dev/app-spec/v1` spec from a file, an https URL
 * or inline JSON (extensions/lib/spec_source.ts) and writes, into an app repo
 * checkout:
 *
 * - `extensions/models/<name>.ts` — an extension whose `run` method takes one
 *   argument per specification input and one global argument per setting.
 *   The behaviour is a stub that returns no items.
 * - `extensions/models/<name>_test.ts` — tests that pin the argument contract
 *   and the result resource.
 * - `workflows/workflow-<slug>.yaml` — a workflow named `<typeScope>/<slug>`
 *   whose inputs are exactly the specification inputs, so a form can be
 *   rendered from them. The manifest lists it, so `extension pull` brings it along;
 *   it runs the `<name>-model` instance.
 * - `puddles/<name>/` — publish manifest, README and a CLAUDE.md that states
 *   the bounded purpose and what is out of scope.
 *
 * The draft passes `deno check` and its own tests as generated. Factory reads
 * no other app's data: whoever approved the spec did so before handing it
 * over. The `factory-build` skill then plans the behaviour.
 *
 * @module
 */
import { z } from "npm:zod@4";
import {
  type AppSpec,
  type DeliveryMethod,
  specificationProblems,
  type SpecInput,
  type SpecSource,
  SpecSourceSchema,
} from "../contracts/app_spec_v1.ts";
import {
  loadAppSpec,
  loadOutcomeSpec,
  type SpecIo,
} from "../lib/spec_source.ts";
import { prefillAppSpec } from "../lib/prefill.ts";
import {
  BUILD_RESULT_V1,
  type BuildResult,
  BuildResultSchema,
  parseBuildResult,
} from "../contracts/build_result_v1.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Delivery methods whose app is a swamp workflow the generator can draft. */
const DRAFTABLE: readonly DeliveryMethod[] = [
  "workflow_form",
  "scheduled_workflow",
  "packaged_script",
];

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** What renderDraft needs besides the spec: the clock, ids and package settings. */
export interface RenderOptions {
  now: Date;
  /** Id of the generated workflow. */
  uuid: string;
  /** Scope for the generated extension type. Defaults to `@puddleworks`. */
  typeScope?: string;
  /**
   * Registry visibility. Omitted or `"public"` writes no `visibility:` line
   * (public is the registry default); `"private"` writes `visibility: private`.
   */
  visibility?: "public" | "private";
}

/** One generated file, its path relative to the target checkout. */
export interface DraftFile {
  /** Path relative to the app repo root. */
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * The zod specifier for generated extensions. Assembled at runtime because
 * swamp's bundler rewrites any zod import it finds in this file's text —
 * template strings included — to its injected copy.
 */
const ZOD_SPECIFIER = ["npm:", "zod@4"].join("");

/**
 * The generated `export const model` line, built so draft.ts holds only its own.
 * The registry catalog reads type and version from the first one it finds in
 * this file's text, template strings included.
 */
const MODEL_EXPORT = ["export const", "model = {"].join(" ");

/** A JSON string literal is valid TypeScript and a valid YAML scalar. */
const q = (s: string): string => JSON.stringify(s);

/** Make text safe inside a JSDoc block. */
const docText = (s: string): string => s.replaceAll("*/", "*\\/");

function jsdoc(lines: string[], indent = ""): string {
  const body = lines.flatMap((l) => docText(l).split("\n"))
    .map((l) => (l ? `${indent} * ${l}` : `${indent} *`));
  return [`${indent}/**`, ...body, `${indent} */`].join("\n");
}

function versionFor(now: Date): string {
  const d = now.toISOString().slice(0, 10).replaceAll("-", ".");
  return `${d}.1`;
}

function zodFor(i: SpecInput): string {
  const base = {
    string: "z.string()",
    number: "z.number()",
    integer: "z.number().int()",
    boolean: "z.boolean()",
  }[i.type];
  const shape = i.required
    ? (i.type === "string" ? `${base}.min(1)` : base)
    : `${base}.default(${JSON.stringify(i.default)})`;
  return `${shape}.describe(${q(i.description)})`;
}

/** A value of the input's type, for the generated tests. */
function sampleFor(i: SpecInput): string {
  return { string: '"example"', number: "1.5", integer: "2", boolean: "true" }[
    i.type
  ];
}

/** A value of the wrong type, for the generated tests. */
function wrongFor(i: SpecInput): string {
  return { string: "1", number: '"1"', integer: "1.5", boolean: '"yes"' }[
    i.type
  ];
}

/** A line linking back to where the spec was agreed, with what the source gives. */
function agreedAt(source: SpecSource): string {
  const parts = [`[where it was agreed](${source.url})`];
  if (source.version !== undefined) parts.push(`version ${source.version}`);
  if (source.specHash) parts.push(`hash \`${source.specHash}\``);
  return `Spec: ${parts.join(", ")}.`;
}

function describeDefault(i: SpecInput): string {
  if (i.required) return "required";
  return i.default === "" ? "empty" : `\`${JSON.stringify(i.default)}\``;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

interface Names {
  app: string;
  fileBase: string;
  modelType: string;
  /** The model instance the workflow runs, `<name>-model`. */
  instance: string;
  /** Workflow file name part: `workflows/workflow-<slug>.yaml`. */
  slug: string;
  /** Workflow name, `<typeScope>/<slug>`: a packaged workflow carries its collective. */
  entryPointRef: string;
  version: string;
}

function renderExtension(input: AppSpec, n: Names): string {
  const spec = input.specification;
  const settings = spec.settings ?? [];
  const settingLines = settings.map((s) =>
    s.sensitive
      ? `  ${s.name}: z.string().min(1).meta({ sensitive: true, description: ${
        q(s.description)
      } }),`
      : `  ${s.name}: z.string().min(1).describe(${q(s.description)}),`
  );
  const inputLines = spec.inputs.map((i) => `  ${i.name}: ${zodFor(i)},`);

  const header = jsdoc([
    `${n.modelType} — ${input.title}`,
    "",
    spec.purpose,
    "",
    `Output: ${spec.output}`,
    "",
    "Out of scope:",
    ...spec.outOfScope.map((o) => `- ${o}`),
    "",
    "First draft generated by puddleworks-factory from the app spec",
    `\`${n.app}\`. \`run\` is a stub: replace it with`,
    "the real behaviour, keeping the argument names the workflow passes.",
    "",
    "@module",
  ]);

  return `${header}
import { z } from ${q(ZOD_SPECIFIER)};

/** Settings fixed once per model instance by the builder, not the person running it. */
export const GlobalArgsSchema = z.object({
${settingLines.join("\n")}
});
export type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/** Arguments for \`run\` — one per specification input. */
export const RunArgsSchema = z.object({
${inputLines.join("\n")}
});
export type RunArgs = z.infer<typeof RunArgsSchema>;

${jsdoc([`One run's result. ${spec.output}`])}
export const ResultSchema = z.object({
  args: RunArgsSchema,
  items: z.array(z.unknown()),
  ranAt: z.iso.datetime(),
});
export type Result = z.infer<typeof ResultSchema>;

${
    jsdoc([
      spec.purpose,
      "",
      "TODO(draft): implement. Returns no items until then.",
    ])
  }
export function run(_args: RunArgs, _settings: GlobalArgs): Promise<unknown[]> {
  return Promise.resolve([]);
}

/** What the run method calls. Tests swap \`run\` here to check the wiring without the real behaviour. */
export const behaviour = { run };

interface MethodContext {
  globalArgs: GlobalArgs;
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
}

${MODEL_EXPORT}
  type: ${q(n.modelType)},
  version: ${q(n.version)},
  globalArguments: GlobalArgsSchema,
  resources: {
    result: {
      description: ${q(spec.output)},
      schema: ResultSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
  },
  methods: {
    run: {
      description: ${q(spec.purpose)},
      arguments: RunArgsSchema,
      execute: async (args: RunArgs, context: MethodContext) => {
        const items = await behaviour.run(args, context.globalArgs);
        const result: Result = { args, items, ranAt: new Date().toISOString() };
        const handle = await context.writeResource("result", "result", result);
        return { dataHandles: [handle] };
      },
    },
  },
};
`;
}

function renderTests(input: AppSpec, n: Names): string {
  const spec = input.specification;
  const settings = spec.settings ?? [];
  const required = spec.inputs.filter((i) => i.required);
  const optional = spec.inputs.filter((i) => !i.required);
  const obj = (entries: string[]) =>
    entries.length ? `{ ${entries.join(", ")} }` : "{}";

  const requiredObj = obj(required.map((i) => `${i.name}: ${sampleFor(i)}`));
  const defaultsObj = obj([
    ...(required.length ? ["...REQUIRED"] : []),
    ...optional.map((i) => `${i.name}: ${JSON.stringify(i.default)}`),
  ]);
  const settingsObj = obj(settings.map((s) => `${s.name}: "example"`));
  const names = spec.inputs.map((i) => q(i.name)).sort().join(", ");

  const tests: string[] = [];
  tests.push(`Deno.test("model type matches the app spec", () => {
  assertEquals(model.type, ${q(n.modelType)});
});`);
  tests.push(
    `Deno.test("run arguments are exactly the specification inputs", () => {
  assertEquals(Object.keys(RunArgsSchema.shape).sort(), [${names}]);
});`,
  );
  tests.push(
    `Deno.test("run arguments apply the specification defaults", () => {
  assertEquals(RunArgsSchema.parse(REQUIRED), ${defaultsObj});
});`,
  );
  for (const i of required) {
    tests.push(`Deno.test(${q(`run arguments require ${i.name}`)}, () => {
  assertEquals(RunArgsSchema.safeParse({ ...REQUIRED, ${i.name}: undefined }).success, false);
});`);
  }
  if (spec.inputs.length) {
    const rows = spec.inputs.map((i) => `    [${q(i.name)}, ${wrongFor(i)}],`);
    tests.push(
      `Deno.test("run arguments reject values of the wrong type", () => {
  const wrong: Array<[string, unknown]> = [
${rows.join("\n")}
  ];
  for (const [name, value] of wrong) {
    assertEquals(RunArgsSchema.safeParse({ ...REQUIRED, [name]: value }).success, false, name);
  }
});`,
    );
  }
  if (settings.length) {
    tests.push(`Deno.test("every setting must be set", () => {
  assertEquals(GlobalArgsSchema.safeParse({}).success, false);
  assertEquals(GlobalArgsSchema.safeParse(SETTINGS).success, true);
});`);
  }
  for (const s of settings.filter((s) => s.sensitive)) {
    tests.push(`Deno.test(${q(`${s.name} is marked sensitive`)}, () => {
  assertEquals(GlobalArgsSchema.shape.${s.name}.meta()?.sensitive, true);
});`);
  }
  tests.push(
    `Deno.test("run writes one result resource with the arguments it ran with", async () => {
  using runStub = stub(behaviour, "run", () => Promise.resolve([]));
  const args = RunArgsSchema.parse(REQUIRED);
  const writes: Array<{ specName: string; data: Record<string, unknown> }> = [];
  const out = await model.methods.run.execute(args, {
    globalArgs: SETTINGS,
    writeResource: (specName, name, data) => {
      writes.push({ specName, data });
      return Promise.resolve({ name });
    },
  });
  assertEquals(out.dataHandles.length, 1);
  assertSpyCallArgs(runStub, 0, [args, SETTINGS]);
  assertEquals(writes.length, 1);
  assertEquals(writes[0].specName, "result");
  assertEquals(writes[0].data.args, args);
  assertEquals(ResultSchema.safeParse(writes[0].data).success, true);
});`,
  );

  return `${
    jsdoc([
      `Tests for ${n.modelType}.`,
      "",
      `Run with the "Test it" command in puddles/${n.app}/README.md.`,
      "",
      "@module",
    ])
  }
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { assertSpyCallArgs, stub } from "jsr:@std/testing@1.0.21/mock";
import {
  behaviour,
  type GlobalArgs,
  GlobalArgsSchema,
  model,
  ResultSchema,
  RunArgsSchema,
} from "./${n.fileBase}.ts";

/** Values for the required inputs. */
const REQUIRED = ${requiredObj};

/**
 * Placeholders that only need to pass the schema: these tests stub \`run\`.
 * Tests of the real behaviour call \`run\` with working settings of their own.
 */
const SETTINGS: GlobalArgs = ${settingsObj};

${tests.join("\n\n")}
`;
}

function renderWorkflow(input: AppSpec, n: Names, uuid: string): string {
  const spec = input.specification;
  const props = spec.inputs.flatMap((i) => [
    `    ${i.name}:`,
    `      type: ${i.type}`,
    `      description: ${q(i.description)}`,
    ...(i.required ? [] : [`      default: ${JSON.stringify(i.default)}`]),
  ]);
  const required = spec.inputs.filter((i) => i.required).map((i) =>
    `    - ${i.name}`
  );
  const passes = spec.inputs.map((i) =>
    `            ${i.name}: \${{ inputs.${i.name} }}`
  );

  return `id: ${uuid}
name: ${q(n.entryPointRef)}
description: ${q(spec.purpose)}
version: 1
tags:
  puddle: "true"

inputs:
  type: object
  properties:${props.length ? "\n" + props.join("\n") : " {}"}
  required:${required.length ? "\n" + required.join("\n") : " []"}

jobs:
  - name: main
    description: ${q(`Run ${n.app} once with the user's inputs.`)}
    dependsOn: []
    weight: 0
    steps:
      - name: run
        description: ${q(spec.output)}
        dependsOn: []
        weight: 0
        allowFailure: false
        task:
          type: model_method
          modelIdOrName: ${n.instance}
          methodName: run
          inputs:${passes.length ? "\n" + passes.join("\n") : " {}"}
`;
}

function renderManifest(
  input: AppSpec,
  n: Names,
  visibility: RenderOptions["visibility"],
): string {
  return `manifestVersion: 1
name: ${q(n.modelType)}
version: ${q(n.version)}
description: ${q(input.specification.purpose)}
${visibility === "private" ? "visibility: private\n" : ""}additionalFiles:
  - README.md
models:
  - ${n.fileBase}.ts
workflows:
  - workflow-${n.slug}.yaml
`;
}

function userHowTo(method: DeliveryMethod): string {
  switch (method) {
    case "workflow_form":
      return "Your builder will show you where to run it. Each run asks for the values below.";
    case "scheduled_workflow":
      return "The app runs on a schedule your builder sets. Each run uses the values below.";
    default:
      return "Your builder will give you a one-line command to run it. It asks for the values below.";
  }
}

function renderReadme(input: AppSpec, n: Names): string {
  const spec = input.specification;
  const settings = spec.settings ?? [];
  const rows = spec.inputs.map((i) =>
    `| ${i.description} | ${i.type} | ${describeDefault(i)} |`
  );
  const globalArgs = settings.map((s) =>
    s.sensitive
      ? `  --global-arg '${s.name}=\${{ vault.get("<vault>", "${s.name}") }}'`
      : `  --global-arg ${s.name}=<${s.name}>`
  );
  const createCmd = [
    `swamp model create ${n.modelType} ${n.instance}`,
    ...globalArgs,
  ].join(" \\\n");
  const runInputs = spec.inputs.filter((i) => i.required).map((i) =>
    ` --input ${i.name}=<${i.name}>`
  ).join("");
  // The draft sets no schedule, so the builder sets one in serve.yaml.
  const scheduleIt = input.delivery.method === "scheduled_workflow"
    ? `
Schedule it. The draft sets no schedule: pick a cron expression (this one runs
daily at 09:00), then restart \`swamp serve\` so it picks up the trigger:

\`\`\`bash
swamp workflow trigger set ${n.entryPointRef} --schedule "0 9 * * *"${runInputs}
\`\`\`
`
    : "";

  return `# ${input.title}

${spec.purpose}

## For the user

${userHowTo(input.delivery.method)}

${
    rows.length
      ? `| What to enter | Kind | Default |\n|---|---|---|\n${
        rows.join("\n")
      }\n`
      : "It needs nothing from you.\n"
  }
**You get:** ${spec.output}

## For the builder

First draft generated by puddleworks-factory from the app spec \`${n.app}\`.
See [CLAUDE.md](CLAUDE.md) for the bounded purpose and what is out of scope.
${input.source ? `\n${agreedAt(input.source)}\n` : ""}
- Extension: \`${n.modelType}\` in \`extensions/models/${n.fileBase}.ts\`
- Entry point: workflow \`${n.entryPointRef}\` in
  \`workflows/workflow-${n.slug}.yaml\`
- Delivery method: \`${input.delivery.method}\`

Create the model instance the workflow runs${
    settings.some((s) => s.sensitive)
      ? " (store each secret in a vault first)"
      : ""
  }:

\`\`\`bash
${createCmd}
\`\`\`

Run it:

\`\`\`bash
swamp workflow run ${n.entryPointRef}${runInputs}
\`\`\`
${scheduleIt}
Test it:

\`\`\`bash
DENO=$(swamp doctor extensions --json | jq -r '.denoPath')
$DENO check extensions/models/${n.fileBase}.ts
$DENO test extensions/models/${n.fileBase}_test.ts
\`\`\`
`;
}

function renderClaude(input: AppSpec, n: Names): string {
  const spec = input.specification;
  const settings = spec.settings ?? [];
  const inputs = spec.inputs.map((i) =>
    `- \`${i.name}\` (${i.type}, ${describeDefault(i)}) — ${i.description}`
  );
  const settingLines = settings.map((s) =>
    `- \`${s.name}\`${
      s.sensitive ? " (secret — vault only)" : ""
    } — ${s.description}`
  );

  return `# ${n.app}

${input.title}. Built by puddleworks-factory from the app spec \`${n.app}\`;
the specification below was agreed before it was handed over.
${input.source ? `\n${agreedAt(input.source)}\n` : ""}
## Bounded purpose

${spec.purpose}

## Inputs (the run form)

${inputs.length ? inputs.join("\n") : "None."}

## Settings (set once per model instance)

${settingLines.length ? settingLines.join("\n") : "None."}

## Output

${spec.output}

## Out of scope

${spec.outOfScope.map((o) => `- ${o}`).join("\n")}

Anything on this list, or anything beyond the purpose above, needs a new
spec. Do not add it here, and do not add permissions or secrets the
settings above do not name.

## Finishing the draft

1. Replace the \`run\` stub in \`extensions/models/${n.fileBase}.ts\` with the
   real behaviour. Keep the argument names: the workflow and the run form
   depend on them.
2. Give \`ResultSchema.items\` the shape of the output above, and add tests for
   the behaviour to \`extensions/models/${n.fileBase}_test.ts\`. Leave the
   generated tests as they are: they stub \`run\`, so they keep passing. Tests
   of the behaviour call \`run\` directly with working settings.
3. If the tests need permissions (\`--allow-read\`, \`--allow-net\`, …), add the
   same flags to the "Test it" command in \`README.md\` and to this app's line
   in the repo \`Makefile\`.
4. \`deno check\` and \`deno test\` must pass before review.
`;
}

/**
 * Render the first draft for an app spec. Pure: the clock and
 * the workflow id are passed in.
 */
export function renderDraft(
  input: AppSpec,
  opts: RenderOptions,
): DraftFile[] {
  const { name, delivery } = input;
  if (!SLUG.test(name)) {
    throw new Error(
      `App name "${name}" is not a slug (lowercase letters, digits and hyphens).`,
    );
  }
  if (!DRAFTABLE.includes(delivery.method)) {
    throw new Error(
      `Delivery method "${delivery.method}" has no swamp workflow to draft. ` +
        `Only ${DRAFTABLE.join(", ")} can be drafted.`,
    );
  }
  const scope = opts.typeScope ?? "@puddleworks";
  const ref = delivery.entryPointRef ?? name;
  const slug = ref.startsWith(`${scope}/`) ? ref.slice(scope.length + 1) : ref;
  if (!SLUG.test(slug)) {
    throw new Error(
      `entryPointRef "${ref}" must be a slug or ${scope}/<slug>, so it can ` +
        `name the workflow file and carry the package's collective.`,
    );
  }
  const problems = specificationProblems(input.specification);
  if (problems.length > 0) {
    throw new Error(
      `The specification needs fixing before a draft:\n- ${
        problems.join("\n- ")
      }`,
    );
  }

  const n: Names = {
    app: name,
    fileBase: name.replaceAll("-", "_"),
    modelType: `${scope}/${name}`,
    instance: `${name}-model`,
    slug,
    entryPointRef: `${scope}/${slug}`,
    version: versionFor(opts.now),
  };
  return [
    {
      path: `extensions/models/${n.fileBase}.ts`,
      content: renderExtension(input, n),
    },
    {
      path: `extensions/models/${n.fileBase}_test.ts`,
      content: renderTests(input, n),
    },
    {
      path: `workflows/workflow-${n.slug}.yaml`,
      content: renderWorkflow(input, n, opts.uuid),
    },
    {
      path: `puddles/${n.app}/manifest.yaml`,
      content: renderManifest(input, n, opts.visibility),
    },
    { path: `puddles/${n.app}/README.md`, content: renderReadme(input, n) },
    { path: `puddles/${n.app}/CLAUDE.md`, content: renderClaude(input, n) },
  ];
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const GlobalArgsSchema = z.object({
  /** Scope for generated extension types, e.g. `@puddleworks`. */
  typeScope: z.string().regex(/^@[a-z0-9-]+$/).default("@puddleworks"),
});

const DraftSchema = z.object({
  /** The app spec's name. */
  name: z.string(),
  /** `inline`, or the path or URL the spec was read from. */
  specSource: z.string(),
  /** Where the spec was agreed, when it said. */
  source: SpecSourceSchema.optional(),
  targetDir: z.string(),
  modelType: z.string(),
  entryPointRef: z.string(),
  /** Paths written, relative to targetDir. */
  files: z.array(z.string()),
  /** Paths that already existed and were replaced (overwrite=true only). */
  overwrote: z.array(z.string()),
  renderedAt: z.iso.datetime(),
});

const PrefillSchema = z.object({
  /** The app name the starter suggests. */
  name: z.string(),
  /** `inline`, or the path or URL the outcome spec was read from. */
  specSource: z.string(),
  /** Where the starter app spec was written. */
  out: z.string(),
  /** Where the outcome spec was agreed. */
  source: SpecSourceSchema,
  /** Fields the builder must check or fill in, `<field>: <why>`. */
  toDecide: z.array(z.string()),
  /** Things in the outcome spec to sort out before building. */
  warnings: z.array(z.string()),
  prefilledAt: z.iso.datetime(),
});

const PrefillArgsSchema = z.object({
  /**
   * A puddleworks.dev/outcome-spec/v1: a file path, an https URL, or the
   * spec itself as inline JSON.
   */
  outcomeSpec: z.string().min(1),
  /** File to write the starter app spec to, as JSON. */
  out: z.string().min(1),
  /** Replace out if it is already there. Default false: it may hold the builder's edits. */
  overwrite: z.boolean().default(false),
});

type PrefillArgs = z.infer<typeof PrefillArgsSchema>;

const RenderArgsSchema = z.object({
  /**
   * A puddleworks.dev/app-spec/v1 spec: a file path, an https URL, or the
   * spec itself as inline JSON.
   */
  spec: z.string().min(1),
  /** Absolute path of an app repo checkout. */
  targetDir: z.string().min(1),
  overwrite: z.boolean().default(false),
  /** "public" is the default; "private" keeps the package off the public registry. */
  visibility: z.enum(["public", "private"]).default("public"),
});

type RenderArgs = z.infer<typeof RenderArgsSchema>;

/** Workflows pass "" for an input left blank; treat it as not given. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const ResultArgsSchema = z.object({
  /** The app spec's name, as drafted by `render` on this instance. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** https URL of the repository the draft was pushed to. */
  repository: z.string().min(1),
  /** Branch or commit the build is on, e.g. `draft/<name>`. */
  buildRef: z.string().min(1),
  /** https URL of the pull request, once there is one. */
  pullRequest: optional(z.string()),
  /** File to write the build result to as JSON, as well as the resource. */
  out: optional(z.string()),
});

type ResultArgs = z.infer<typeof ResultArgsSchema>;

/** Name of the build result resource for an app spec. */
const resultName = (name: string) => `build-result-${name}`;

/** Where specs are read from. Tests swap these to avoid the network. */
export const io: SpecIo = {
  readTextFile: (path) => Deno.readTextFile(path),
  fetch: (url) => fetch(url),
};

interface MethodContext {
  globalArgs: { typeScope: string };
  logger: { info: (msg: string, props?: Record<string, unknown>) => void };
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
  readResource?: (
    instanceName: string,
    version?: number,
  ) => Promise<Record<string, unknown> | null>;
}

/** Write text to path, creating its directory first when it names one. */
async function writeFileIn(path: string, text: string): Promise<void> {
  const slash = path.lastIndexOf("/");
  if (slash > 0) await Deno.mkdir(path.slice(0, slash), { recursive: true });
  await Deno.writeTextFile(path, text);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/**
 * The `@puddleworks/puddleworks-factory/draft` model: `prefill` starts an app spec
 * from an outcome spec, `render` writes a first draft from an app spec, and
 * `result` says where that build went.
 */
export const model = {
  type: "@puddleworks/puddleworks-factory/draft",
  version: "2026.10.23.1",
  upgrades: [
    {
      toVersion: "2026.10.16.2",
      description:
        "Adds the result method and the buildResult resource (build-result/v1). " +
        "No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.22.1",
      description:
        "Adds the prefill method and resource (outcome-spec/v1 in), and an optional " +
        "source on the draft resource. No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.23.1",
      description:
        "Moves to the @puddleworks collective. Drafted READMEs no longer point at " +
        "puddle, scheduled drafts say how to set the schedule, and generated tests " +
        "pin @std versions. No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  globalArguments: GlobalArgsSchema,
  resources: {
    prefill: {
      description:
        "The last starter app spec prefilled from an outcome spec: where it was written and what the builder still has to decide.",
      schema: PrefillSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
    draft: {
      description:
        "The last first draft rendered for an app spec: which files were written where.",
      schema: DraftSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
    buildResult: {
      description:
        `A ${BUILD_RESULT_V1}: what a build produced and where it is, for anyone to read.`,
      schema: BuildResultSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
  },
  methods: {
    prefill: {
      description:
        "Write a starter app spec from an agreed outcome spec (puddleworks.dev/outcome-spec/v1), " +
        "read from a file, an https URL or inline JSON: what can be copied across, a link back to " +
        "where it was agreed, and blanks for the builder's decisions, which are listed in the " +
        "prefill resource. Refuses to replace out unless overwrite=true.",
      arguments: PrefillArgsSchema,
      execute: async (args: PrefillArgs, context: MethodContext) => {
        const { spec: outcome, source } = await loadOutcomeSpec(
          args.outcomeSpec,
          io,
        );
        if ((await exists(args.out)) && !args.overwrite) {
          throw new Error(
            `Refusing to replace ${args.out}: it may hold the builder's edits. ` +
              "Pass overwrite=true to replace it.",
          );
        }
        const { spec, toDecide, warnings } = prefillAppSpec(outcome);
        await writeFileIn(args.out, JSON.stringify(spec, null, 2) + "\n");
        context.logger.info("Prefilled {name} from {source} into {out}", {
          name: spec.name,
          source,
          out: args.out,
        });
        const handle = await context.writeResource(
          "prefill",
          `prefill-${spec.name}`,
          {
            name: spec.name,
            specSource: source,
            out: args.out,
            source: spec.source,
            toDecide,
            warnings,
            prefilledAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      },
    },
    render: {
      description:
        "Write a first draft (extension, tests, workflow, puddle docs) for an app spec, " +
        "read from a file, an https URL or inline JSON, into an app repo checkout. " +
        "Refuses to overwrite files unless overwrite=true.",
      arguments: RenderArgsSchema,
      execute: async (args: RenderArgs, context: MethodContext) => {
        const root = args.targetDir.replace(/\/+$/, "");
        if (!(await exists(`${root}/extensions/models`))) {
          throw new Error(
            `${root} does not look like an app repo checkout: it has no extensions/models/ directory. ` +
              "Pass targetDir as the path of an app repo checkout, e.g. a git worktree of it.",
          );
        }

        const { spec, source } = await loadAppSpec(args.spec, io);
        const files = renderDraft(spec, {
          now: new Date(),
          uuid: crypto.randomUUID(),
          typeScope: context.globalArgs.typeScope,
          visibility: args.visibility,
        });

        const present: string[] = [];
        for (const f of files) {
          if (await exists(`${root}/${f.path}`)) present.push(f.path);
        }
        if (present.length > 0 && !args.overwrite) {
          throw new Error(
            `Refusing to overwrite files that already exist: ${
              present.join(", ")
            }. ` +
              "Pass overwrite=true to replace them.",
          );
        }

        for (const f of files) {
          const path = `${root}/${f.path}`;
          await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
            recursive: true,
          });
          await Deno.writeTextFile(path, f.content);
        }

        const workflow = files[2].path;
        context.logger.info("Drafted {name} from {source} into {targetDir}", {
          name: spec.name,
          source,
          targetDir: root,
        });

        const handle = await context.writeResource("draft", spec.name, {
          name: spec.name,
          specSource: source,
          ...(spec.source ? { source: spec.source } : {}),
          targetDir: root,
          modelType: `${context.globalArgs.typeScope}/${spec.name}`,
          entryPointRef: `${context.globalArgs.typeScope}/${
            workflow.slice("workflows/workflow-".length, -".yaml".length)
          }`,
          files: files.map((f) => f.path),
          overwrote: present,
          renderedAt: new Date().toISOString(),
        });
        return { dataHandles: [handle] };
      },
    },
    result: {
      description:
        `Write a ${BUILD_RESULT_V1} for the last draft of an app spec: the extension, ` +
        "its entry point, the repository, the branch or commit, and the pull request. " +
        "Records it as a resource and, with out, as a JSON file.",
      arguments: ResultArgsSchema,
      execute: async (args: ResultArgs, context: MethodContext) => {
        const raw = context.readResource
          ? await context.readResource(args.name)
          : null;
        const draft = raw ? DraftSchema.safeParse(raw) : null;
        if (!draft?.success) {
          throw new Error(
            `No draft of "${args.name}" has been rendered by this model instance. ` +
              "Run @puddleworks/puddleworks-factory-build for the spec first.",
          );
        }
        const manifest = draft.data.files.find((f) =>
          f.endsWith("/manifest.yaml")
        );
        const candidate: BuildResult = {
          apiVersion: BUILD_RESULT_V1,
          kind: "BuildResult",
          name: args.name,
          extension: draft.data.modelType,
          entryPointRef: draft.data.entryPointRef,
          repository: args.repository,
          ...(manifest
            ? { path: manifest.slice(0, manifest.lastIndexOf("/")) }
            : {}),
          buildRef: args.buildRef,
          ...(args.pullRequest ? { pullRequest: args.pullRequest } : {}),
          ...(draft.data.source ? { source: draft.data.source } : {}),
          builtAt: new Date().toISOString(),
        };
        const parsed = parseBuildResult(candidate);
        if (!parsed.ok) {
          throw new Error(
            `The build result is not a valid ${BUILD_RESULT_V1}:\n- ${
              parsed.problems.join("\n- ")
            }`,
          );
        }

        if (args.out) {
          await writeFileIn(
            args.out,
            JSON.stringify(parsed.result, null, 2) + "\n",
          );
        }
        context.logger.info("Build result for {name}: {buildRef}", {
          name: args.name,
          buildRef: args.buildRef,
        });
        const handle = await context.writeResource(
          "buildResult",
          resultName(args.name),
          parsed.result,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
