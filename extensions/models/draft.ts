/**
 * @puddleworks/puddleworks-factory/draft — turn an app spec into a first draft of
 * the app.
 *
 * `prefill` reads an agreed `puddleworks.dev/outcome-spec/v1` and writes a
 * starter app spec for the builder to finish (extensions/lib/prefill.ts).
 *
 * `render` reads a `puddleworks.dev/app-spec/v1` spec from a file, an https URL
 * or inline JSON (extensions/lib/spec_source.ts) and writes, into the root of
 * the app's own repo checkout:
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
 * - `manifest.yaml`, `README.md` and `LICENSE` — the publish manifest, with
 *   its licence and repository link, and what it ships. A LICENSE the repo
 *   already has is kept.
 * - `.github/workflows/ci.yml` — the tests and a publish dry run. One the repo
 *   already has is kept.
 * - `CLAUDE.md` — a marked section that states the bounded purpose and what is
 *   out of scope, added to the repo's own CLAUDE.md if it has one.
 *
 * The draft passes `deno check` and its own tests as generated. Factory reads
 * no other app's data: whoever approved the spec did so before handing it
 * over. The `factory-build` skill then builds the behaviour, `visibility`
 * checks the repo before it is published (extensions/lib/visibility.ts), and
 * `readiness` checks the independent review and summarises what would be
 * published (extensions/lib/readiness.ts).
 *
 * @module
 */
import { z } from "npm:zod@4";
import { parse as parseYaml } from "jsr:@std/yaml@1.0.12";
import {
  type AppSpec,
  type DeliveryMethod,
  specificationProblems,
  type SpecInput,
  type SpecSource,
} from "../contracts/app_spec_v1.ts";
import {
  loadAppSpec,
  loadOutcomeSpec,
  sourceLabel,
  type SpecIo,
} from "../lib/spec_source.ts";
import { prefillAppSpec } from "../lib/prefill.ts";
import {
  reservedNameProblem,
  reservedPrefix,
  RESOURCE_PREFIX,
  secretNameProblem,
} from "../lib/names.ts";
import { assessVisibility } from "../lib/visibility.ts";
import { linkProblem, safeData, safeText } from "../lib/redact.ts";
import { assessReadiness } from "../lib/readiness.ts";
import {
  DRAFT_LINE,
  RECIPE_BUDGET_SECONDS,
  RECIPE_LABEL,
  type RecipeFit,
  recipeFit,
  type RecipeInputs,
  recipeSource,
} from "../lib/recipes.ts";
import {
  realSwamp,
  recipeReadiness,
  type SwampRun,
} from "../lib/recipe_check.ts";
import {
  DraftSchema,
  PrefillSchema,
  ReadinessSchema,
  VisibilitySchema,
} from "../lib/records.ts";
import {
  BUILD_RESULT_V1,
  BuildExamplesSchema,
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
  /** Id of the generated recipe workflow, if the spec gets one. Random if not given. */
  recipeUuid?: string;
  /** `https://` URL of the app's repository, for the manifest and LICENSE. */
  repository: string;
  /** Scope for the generated extension type. Defaults to `@puddleworks`. */
  typeScope?: string;
  /** Registry visibility. Defaults to `"private"`. */
  visibility?: "public" | "private";
}

/** One generated file, its path relative to the target checkout. */
export interface DraftFile {
  /** Path relative to the app repo root. */
  path: string;
  content: string;
  /**
   * How the file meets one already there. `replace` (the default) needs
   * overwrite=true; `keep` leaves it as it is; `section` places the content
   * as a marked section (see placeSection).
   */
  existing?: "replace" | "keep" | "section";
}

/** Markers around the app's section of CLAUDE.md. */
export const CLAUDE_BEGIN = "<!-- BEGIN puddleworks-factory app section -->";
export const CLAUDE_END = "<!-- END puddleworks-factory app section -->";

/**
 * Put a marked section into a file's text: replace the section if the text
 * has one, add it at the end if not, or use it alone when there is no file.
 * A begin marker with no end marker after it is refused.
 * `replaced` says whether an earlier section was replaced.
 */
export function placeSection(
  existing: string | null,
  section: string,
): { text: string; replaced: boolean } {
  if (existing === null) return { text: section, replaced: false };
  const start = existing.indexOf(CLAUDE_BEGIN);
  const end = existing.indexOf(CLAUDE_END, start);
  if (start >= 0 && end < 0) {
    // Appending would leave two sections, and a later render would replace
    // everything from the first to the new end: the builder's text between.
    throw new Error(
      `CLAUDE.md has ${CLAUDE_BEGIN} but no ${CLAUDE_END} after it: put the end ` +
        "marker back where the Factory's section ends, then render again.",
    );
  }
  if (start >= 0 && end >= 0) {
    const after = existing.slice(end + CLAUDE_END.length).replace(/^\n/, "");
    return {
      text: existing.slice(0, start) + section + after,
      replaced: true,
    };
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return { text: existing + sep + section, replaced: false };
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
/** The settings, as the run method receives them. */
export type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

/** Arguments for \`run\` — one per specification input. */
export const RunArgsSchema = z.object({
${inputLines.join("\n")}
});
/** The inputs of one run. */
export type RunArgs = z.infer<typeof RunArgsSchema>;

${jsdoc([`One run's result. ${spec.output}`])}
export const ResultSchema = z.object({
  args: RunArgsSchema,
  items: z.array(z.unknown()),
  ranAt: z.iso.datetime(),
});
/** One run's result, as written to the result resource. */
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

/** The \`${n.modelType}\` model: one \`run\` method that writes one result. */
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
      `Run with the "Test it" command in README.md.`,
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
  maxReruns: "5"
  maxWallClock: "30m"

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

/**
 * The recipe workflow: one step calling the app's method, with the recipe in
 * its tag. A draft, like the rest: its \`each.line\` can't be known until the
 * items have a shape, and readiness blocks until it is set.
 */
function renderRecipeWorkflow(
  input: AppSpec,
  n: Names,
  fit: { pattern: string; inputs: RecipeInputs },
  uuid: string,
): string {
  const spec = input.specification;
  const whenEmpty = spec.recipe?.whenEmpty.trim();
  const source = recipeSource(input.source);
  const tag = JSON.stringify({
    id: n.app,
    extension: n.modelType,
    pattern: fit.pattern,
    dataName: "result",
    inputs: fit.inputs,
    each: { path: "items", line: DRAFT_LINE },
    // Braces would be read as fields to fill in.
    template: `${spec.output.replace(/[{}]/g, "")}\n{lines}`,
    ...(whenEmpty ? { empty: whenEmpty } : {}),
    ...(source ? { source } : {}),
  });
  const used = spec.inputs.filter((i) => i.name in fit.inputs);
  const props = used.flatMap((i) => [
    `    ${i.name}:`,
    `      type: ${i.type}`,
    `      description: ${q(i.description)}`,
  ]);
  const required = used.map((i) => `    - ${i.name}`);
  const passes = used.map((i) =>
    `            ${i.name}: \${{ inputs.${i.name} }}`
  );
  return `id: ${uuid}
name: ${q(`${n.entryPointRef}-recipe`)}
description: ${q(`Answer the phrases agreed for ${n.app}.`)}
version: 1
tags:
  maxReruns: "3"
  maxWallClock: "1m"
  puddlerouterRecipe: '${tag.replaceAll("'", "''")}'

inputs:
  type: object
  properties:${props.length ? "\n" + props.join("\n") : " {}"}
  required:${required.length ? "\n" + required.join("\n") : " []"}

jobs:
  - name: main
    description: ${q(`Run ${n.app} once for a phrase agreed for it.`)}
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
  opts: RenderOptions,
  recipe: boolean,
): string {
  return `manifestVersion: 1
name: ${q(n.modelType)}
version: ${q(n.version)}
description: ${q(input.specification.purpose)}
repository: ${q(opts.repository)}
license: MIT
visibility: ${opts.visibility ?? "private"}
${recipe ? `labels:\n  - ${RECIPE_LABEL}\n` : ""}additionalFiles:
  - README.md
  - LICENSE
models:
  - ${n.fileBase}.ts
workflows:
  - workflow-${n.slug}.yaml
${recipe ? `  - ${recipeFileName(n)}\n` : ""}`;
}

/**
 * Refuse a link that is not a plain https URL. A login or query in it would
 * be written into the manifest, a resource or the viewer, and published.
 */
function checkLink(arg: string, url: string, example: string): void {
  const problem = linkProblem(url) ??
    (/^https:\/\/[^/]+\/./.test(url) ? null : "has no path");
  if (problem === null) return;
  throw new Error(
    `${arg} "${safeText(url)}" ${problem}. Pass the plain https URL, e.g. ` +
      `${example}, and let git find any credentials.`,
  );
}

const REPO_EXAMPLE = "https://github.com/<owner>/<name>";
const PR_EXAMPLE = "https://github.com/<owner>/<name>/pull/<number>";

/** The puddle-tooling tag the drafted ci.yml runs the publish dry run from. */
const TOOLING_REF = "v0.2.1";

/**
 * CI for a repo that has none: the tests, and a publish dry run with the
 * manifest's visibility. A repo made from puddle-template keeps its own.
 */
function renderCi(opts: RenderOptions): string {
  const tests = "deno test extensions/models/";
  return `name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5
        with:
          deno-version: 2.9.7 # matches swamp's bundled deno
      - run: ${tests}
  publish:
    uses: puddle-works/puddle-tooling/.github/workflows/publish.yml@${TOOLING_REF}
    with:
      visibility: ${
    opts.visibility ?? "private"
  } # must equal visibility: in manifest.yaml
      dry-run: true # false pushes
      tests: ${tests}
      tooling-ref: ${TOOLING_REF}
    secrets:
      SWAMP_API_KEY: \${{ secrets.SWAMP_API_KEY }}
      SWAMP_SIGNIN_TOKEN: \${{ secrets.SWAMP_SIGNIN_TOKEN }}
`;
}

function renderLicense(repository: string, now: Date): string {
  const owner = new URL(repository).pathname.split("/").filter(Boolean)[0] ??
    new URL(repository).host;
  return `MIT License

Copyright (c) ${now.getUTCFullYear()} ${owner}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

/**
 * `workflow_form` is deprecated: nothing gives the user a form, so it is
 * drafted as `packaged_script`, a command to run. app-spec/v2 removes it.
 */
function draftedAs(method: DeliveryMethod): DeliveryMethod {
  return method === "workflow_form" ? "packaged_script" : method;
}

function describeMethod(method: DeliveryMethod): string {
  const as = draftedAs(method);
  return as === method
    ? `\`${method}\``
    : `\`${method}\` (deprecated, drafted as \`${as}\`)`;
}

function userHowTo(method: DeliveryMethod): string {
  switch (draftedAs(method)) {
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
- Delivery method: ${describeMethod(input.delivery.method)}

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

CI (\`.github/workflows/ci.yml\`) runs the tests and a publish dry run. The
dry run needs two repository secrets, \`SWAMP_API_KEY\` and
\`SWAMP_SIGNIN_TOKEN\`: \`swamp auth token create\` prints both.
`;
}

/** The file name of the recipe workflow. */
const recipeFileName = (n: Names) => `workflow-${n.slug}-recipe.yaml`;

/** How to finish the recipe, or why there is none; empty when none was asked for. */
function recipeSection(input: AppSpec, n: Names, fit: RecipeFit): string {
  if (!fit) return "";
  const phrases = (input.specification.recipe?.examples ?? []).map((e) =>
    `- ${q(e.phrase)}: ${e.answer}`
  );
  const agreed = `## Recipe

These phrases were agreed for this app:

${phrases.join("\n")}
`;
  if ("reason" in fit) {
    return `${agreed}
No recipe was drafted, so they don't reach it yet. ${fit.reason}

If the app can answer them with one method after all, write
\`workflows/${recipeFileName(n)}\` by hand, list it in \`manifest.yaml\` and
label the manifest \`${RECIPE_LABEL}\`. Readiness then checks it.

`;
  }
  return `${agreed}
\`workflows/${recipeFileName(n)}\` sends them to \`run\`. To finish it:

1. In its \`puddlerouterRecipe\` tag, set \`each.line\` to one line of the answer,
   using fields of each item in \`items\`, like \`{title}\`, and make
   \`template\` read as the answer should.
2. You may widen \`pattern\`, but must not drop an example phrase.
3. Readiness checks each phrase, and the build result reports how each went.

A recipe calls one method, and has ${RECIPE_BUDGET_SECONDS} s to answer before the router gives up on it.

- If the entry point ends up with several steps, keep one method that does them
  all by calling the code directly, and point the recipe at it. Never start
  \`swamp\` on the same instance from a method: it waits on its own lock until it
  fails.
- If that takes too long, or a step belongs to another extension, add a method
  that answers from the latest stored result (\`context.readResource\`), starts
  nothing new, and says so when nothing has run yet. In the recipe workflow, set
  \`methodName\`, and \`dataName\`, \`each\` and \`template\` to fit it.
- If it needs free text, no recipe can call it: delete the file, take it out of
  the manifest's \`workflows:\` and remove the manifest's \`${RECIPE_LABEL}\` label.
  Readiness says so, and no example is reported.

If the recipe's method changes nothing at all, add \`effects-read\` to the
manifest's labels: the recipe then answers without asking first, and readiness
runs it to time it. Otherwise readiness doesn't run it, so time it yourself on
something safe.

Whoever installs it needs the model instance \`${n.instance}\`${
    input.specification.settings?.length ? " with its settings set" : ""
  }.
A collective other than \`@puddleworks\` also needs an \`allow:\` entry in their
\`puddlerouter.yaml\`.

`;
}

function renderClaude(input: AppSpec, n: Names, fit: RecipeFit): string {
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

  return `${CLAUDE_BEGIN}
# ${n.app}

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
   same flags to the "Test it" command in \`README.md\` and to the test commands
   in \`.github/workflows/ci.yml\`, and, if the repo has a \`Makefile\`, to its
   \`test\` target.
4. \`deno check\` and \`deno test\` must pass before review.

${recipeSection(input, n, fit)}${CLAUDE_END}
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
  const prefix = reservedPrefix(name);
  if (prefix) throw new Error(reservedNameProblem(name, prefix));
  const secretName = secretNameProblem("The app name", name);
  if (secretName) throw new Error(secretName);
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
  const secretRef = secretNameProblem("The entryPointRef", slug);
  if (secretRef) throw new Error(secretRef);
  checkLink("repository", opts.repository, REPO_EXAMPLE);
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
  const fit = recipeFit(input.specification);
  const recipeFits = !!fit && "pattern" in fit;
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
      path: "manifest.yaml",
      content: renderManifest(input, n, opts, recipeFits),
    },
    { path: "README.md", content: renderReadme(input, n) },
    {
      path: "LICENSE",
      content: renderLicense(opts.repository, opts.now),
      existing: "keep",
    },
    {
      path: "CLAUDE.md",
      content: renderClaude(input, n, fit),
      existing: "section",
    },
    {
      path: ".github/workflows/ci.yml",
      content: renderCi(opts),
      existing: "keep",
    },
    ...(recipeFits
      ? [{
        path: `workflows/${recipeFileName(n)}`,
        content: renderRecipeWorkflow(
          input,
          n,
          fit,
          opts.recipeUuid ?? crypto.randomUUID(),
        ),
      }]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const GlobalArgsSchema = z.object({
  /** Scope for generated extension types, e.g. `@puddleworks`. */
  typeScope: z.string().regex(/^@[a-z0-9-]+$/).default("@puddleworks").describe(
    "The collective each app is published under, e.g. @your-collective. It " +
      "starts the app's model type, manifest name and workflow name; " +
      "swamp extension push refuses one you are not a member of.",
  ),
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
  /** Absolute path of a checkout of the app's own repo. */
  targetDir: z.string().min(1),
  /** `https://` URL of the app's repo, written into the manifest. */
  repository: z.string().min(1),
  overwrite: z.boolean().default(false),
  /** "private" (the default) keeps the package off the public registry until it is decided otherwise. */
  visibility: z.enum(["public", "private"]).default("private"),
});

type RenderArgs = z.infer<typeof RenderArgsSchema>;

/** Workflows pass "" for an input left blank; treat it as not given. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const ResultArgsSchema = z.object({
  /** The app spec's name, as drafted by `render` on this instance. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** https URL of the repository the draft was pushed to. Defaults to the draft's. */
  repository: optional(z.string().min(1)),
  /** Branch or commit the build is on, e.g. `draft/<name>`; once published, its commit. */
  buildRef: z.string().min(1),
  /** https URL of the pull request, once there is one. */
  pullRequest: optional(z.string()),
  /** File to write the build result to as JSON, as well as the resource. */
  out: optional(z.string()),
  /** The version pushed to the registry, once it is published. Give it with publishedVisibility. */
  publishedVersion: optional(z.string().min(1)),
  /** The visibility it was pushed with. Give it with publishedVersion. */
  publishedVisibility: optional(z.enum(["public", "private"])),
  /** How each of the spec's recipe examples went, once they have been checked. */
  examples: optional(BuildExamplesSchema),
});

type ResultArgs = z.infer<typeof ResultArgsSchema>;

const VisibilityArgsSchema = z.object({
  /** The app spec's name, as drafted by `render` on this instance. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** `swamp extension quality --json` percentage for the app's manifest. */
  quality: z.number().int().min(0).max(100),
  /**
   * The percentage once the registry awards the provisional points it gives
   * only at push (`.ifProvisionalEarned.percentage`); 0 when there are none.
   */
  provisionalQuality: z.number().int().min(0).max(100).default(0),
  /** The app repo's visibility on GitHub. */
  repoVisibility: z.enum(["public", "private"]),
  /** The app repo checkout to check. Defaults to where the draft was written. */
  targetDir: optional(z.string().min(1)),
});

type VisibilityArgs = z.infer<typeof VisibilityArgsSchema>;

const ReadinessArgsSchema = z.object({
  /** The app spec's name, as drafted by `render` on this instance. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** The review report from the publish dry run: absolute, or relative to targetDir. */
  review: z.string().min(1),
  /** https URL of the app's pull request, shown in the summary. */
  pullRequest: optional(z.string()),
  /** The reviewed commit, shown in the summary. */
  commit: optional(z.string()),
  /** The app repo checkout to check. Defaults to where the draft was written. */
  targetDir: optional(z.string().min(1)),
});

type ReadinessArgs = z.infer<typeof ReadinessArgsSchema>;

/** The part of a visibility resource that readiness needs. */
const VisibilityAnswerSchema = VisibilitySchema.pick({
  targetDir: true,
  repoVisibility: true,
  quality: true,
  provisionalQuality: true,
});

/** Directories the visibility check does not read: git, swamp runtime data, dependencies. */
const UNREAD = new Set([".git", ".swamp", "node_modules"]);

/** Where skills live; only those the manifest ships are read. */
const SKILLS_DIR = ".claude/skills";

/** The skills a manifest.yaml at root lists under `skills:`, if any. */
async function shippedSkills(root: string): Promise<Set<string>> {
  try {
    const manifest = parseYaml(
      await Deno.readTextFile(`${root}/manifest.yaml`),
    ) as { skills?: unknown } | null;
    const skills = Array.isArray(manifest?.skills) ? manifest.skills : [];
    return new Set(skills.filter((s): s is string => typeof s === "string"));
  } catch {
    // No manifest, or not YAML: no skill is shipped. Other checks report it.
    return new Set();
  }
}

/**
 * Text files under root, relative paths, skipping UNREAD, symlinks, large
 * files and binaries, and skills the manifest does not ship. `notRead` says
 * what was skipped and why, except git, swamp runtime data and dependencies,
 * which hold nothing the app ships.
 */
async function textFiles(
  root: string,
  dir = "",
  notRead: string[] = [],
  skills?: Set<string>,
): Promise<
  { files: Array<{ path: string; text: string }>; notRead: string[] }
> {
  skills ??= await shippedSkills(root);
  const files: Array<{ path: string; text: string }> = [];
  for await (const e of Deno.readDir(dir ? `${root}/${dir}` : root)) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (UNREAD.has(path)) continue;
    if (dir === SKILLS_DIR && !skills.has(e.name)) {
      notRead.push(`${path}${e.isDirectory ? "/" : ""} (not shipped)`);
      continue;
    }
    if (e.isDirectory) {
      files.push(...(await textFiles(root, path, notRead, skills)).files);
    } else if (e.isSymlink) {
      // Not followed: it may point outside the repo, or at a file it lists twice.
      notRead.push(`${path} (symlink)`);
    } else if (e.isFile) {
      const bytes = await Deno.readFile(`${root}/${path}`);
      if (bytes.length > 512 * 1024) notRead.push(`${path} (over 512 KB)`);
      else if (bytes.includes(0)) notRead.push(`${path} (binary)`);
      else files.push({ path, text: new TextDecoder().decode(bytes) });
    }
  }
  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    notRead: notRead.sort(),
  };
}

/** Name of the build result resource for an app spec. */
const resultName = (name: string) => `${RESOURCE_PREFIX.buildResult}${name}`;

/** Where specs are read from. Tests swap these to avoid the network. */
export const io: SpecIo = {
  readTextFile: (path) => Deno.readTextFile(path),
  fetch: (url, init) => fetch(url, init),
};

interface MethodContext {
  globalArgs: { typeScope: string };
  logger: {
    debug: (msg: string, props?: Record<string, unknown>) => void;
    info: (msg: string, props?: Record<string, unknown>) => void;
    warning: (msg: string, props?: Record<string, unknown>) => void;
  };
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
  readResource?: (
    instanceName: string,
    version?: number,
  ) => Promise<Record<string, unknown> | null>;
  /** Stands in for swamp in tests. */
  runSwamp?: SwampRun;
}

/** Where a check runs when it is not given a targetDir, as a start log says it. */
const DRAFT_CHECKOUT = "its draft's checkout";

/** Log, as a warning, the files a check did not read, if there are any. */
function warnNotRead(context: MethodContext, notRead: string[]): void {
  if (notRead.length === 0) return;
  context.logger.warning(
    "Not read, so not checked: {notRead}. Check these by hand before publishing.",
    { notRead: notRead.join(", ") },
  );
}

/** The part of swamp's pre-flight check context the checks use. */
interface CheckContext {
  methodName: string;
  modelType: string;
  modelId: string;
  dataRepository: {
    findAllForModel: (
      type: string,
      modelId: string,
    ) => Promise<Array<{ name: string }>>;
  };
}

/** What a pre-flight check returns. */
interface CheckResult {
  pass: boolean;
  errors?: string[];
}

/** Each resource's schema, by its spec name. */
const SCHEMAS: Record<string, z.ZodType> = {
  prefill: PrefillSchema,
  draft: DraftSchema,
  buildResult: BuildResultSchema,
  visibility: VisibilitySchema,
  readiness: ReadinessSchema,
};

/**
 * A resource as `safeData` gives it, or an error when that does not match
 * the resource's schema. A method that also writes a file checks first, so
 * it writes neither.
 */
function checkedResource<T>(specName: string, data: T): T {
  const clean = safeData(data);
  const checked = SCHEMAS[specName]?.safeParse(clean);
  if (!checked?.success) {
    throw new Error(
      `The Factory built a ${specName} resource that does not match its schema, ` +
        `so it was not written: ${
          safeText(checked?.error.message ?? "no schema")
        }. Report this as a Factory bug.`,
    );
  }
  return clean;
}

/**
 * The context as a method uses it: every log line and resource as `safeText`
 * gives it, so a token in an argument, a spec or a file is never kept, and a
 * resource that does not match its schema refused rather than written.
 * Exported for tests.
 */
export function guarded(context: MethodContext): MethodContext {
  return {
    ...context,
    logger: {
      debug: (msg, props) =>
        context.logger.debug(safeText(msg), props && safeData(props)),
      info: (msg, props) =>
        context.logger.info(safeText(msg), props && safeData(props)),
      warning: (msg, props) =>
        context.logger.warning(safeText(msg), props && safeData(props)),
    },
    writeResource: (specName, name, data) => {
      try {
        return context.writeResource(
          specName,
          name,
          checkedResource(specName, data),
        );
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
}

/** An error as it may be shown: its message and stack as `safeText` gives them. */
function safeError(e: unknown): Error {
  if (!(e instanceof Error)) return new Error(safeText(String(e)));
  e.message = safeText(e.message);
  if (e.stack) e.stack = safeText(e.stack);
  if (e.cause !== undefined) e.cause = safeError(e.cause);
  return e;
}

/**
 * A method's execute, run with a guarded context, so what it logs, records
 * and throws keeps no secret.
 */
function method<A>(
  run: (args: A, context: MethodContext) => Promise<{ dataHandles: unknown[] }>,
) {
  return async (args: A, context: MethodContext) => {
    try {
      return await run(args, guarded(context));
    } catch (e) {
      throw safeError(e);
    }
  };
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
 * from an outcome spec, `render` writes a first draft from an app spec,
 * `visibility` recommends publishing it publicly or privately, `readiness`
 * says whether the reviewed app is ready to publish, and `result` says where
 * that build went.
 */
export const model = {
  type: "@puddleworks/puddleworks-factory/draft",
  version: "2026.11.06.1",
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
    {
      toVersion: "2026.10.26.1",
      description:
        "render drafts into the root of the app's own repo (manifest, README, LICENSE " +
        "and a CLAUDE.md section, no puddles/<name>/ folder), takes a required " +
        "repository, writes license and repository into the manifest, and drafts " +
        "private by default. The draft resource records repository and visibility, " +
        "and result defaults its repository to the draft's. No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.26.2",
      description:
        "Adds the visibility method and resource (recommend public or private before " +
        "publishing), and publishedVersion and publishedVisibility on result, recorded " +
        "as the build result's published field. No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.26.3",
      description:
        "Adds the readiness method and resource (is the independent review complete, " +
        "is every acceptance criterion checked, and a one-screen summary to confirm " +
        "publishing against). No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.1",
      description:
        "Deprecates delivery method workflow_form: render drafts it as packaged_script " +
        "(the user guide gives a one-line command) and prefill no longer offers it. " +
        "Specs that use it still parse. No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.27.2",
      description:
        "render refuses app names that start with prefill-, build-result-, visibility- " +
        "or readiness-, which would share an instance name with another app's resource, " +
        "and prefill flags a suggested name that does. No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.10.30.1",
      description:
        "visibility findings hold only what matched, never the line, so no secret is " +
        "repeated, and an email is kept as its domain; user:password@host, with or " +
        "without a scheme, sk-ant- keys and labelled AWS secret keys count as secrets; " +
        "a password with no user, and a token as a URL's user, count as secrets; " +
        "check details hide any secret they copy; the repository check fails, and " +
        "render and result refuse, a repository that is not a plain https URL (a " +
        "login, query or fragment in it); result and readiness refuse such a " +
        "pullRequest; the secrets check says which files and symlinks it did not " +
        "read. prefill and render follow a spec URL's redirects themselves, refusing " +
        "a hop off https before it is requested, more than 5 hops, or over 30 " +
        "seconds (body included) or 1 MB, and record, log and show the URL without " +
        "its login or query. Every method logs what it starts on. The viewer hides " +
        "secrets and URL logins and queries in records written before this version, " +
        "and says when it cannot read the records. Every log line and resource, the " +
        "build result file, and a spec's link back to where it was agreed, are kept " +
        "with URLs of any scheme stripped of their login and query, and with secrets " +
        "hidden, now also Stripe, Google, GitLab, npm, OpenAI and Slack webhook " +
        "tokens, JWTs, NAME_PASSWORD=… lines and user:password@localhost. readiness " +
        "runs the visibility checks again on the files as they are, so a secret added " +
        "after the visibility check blocks public, and asks for the check again when " +
        "it was for another checkout or by an older Factory. render refuses a " +
        "CLAUDE.md with the Factory's begin marker but no end marker. A secret is " +
        "found by its name on its own and in any case, also in code, headers and " +
        "connection strings, and as a Bearer token; a whole private key, PGP " +
        "included, is hidden; a URL password that looks like a port is hidden, a " +
        "hidden secret or a bracket no longer ends a URL early, and a placeholder " +
        "only excuses the password itself, not the user; placeholders, names of " +
        "secrets and references to where a secret lives are no longer taken for " +
        "secrets, nor is a value without quotes in source code, outside a string " +
        "or comment. " +
        "A URL " +
        "keeps a query parameter that holds no secret. An outcome spec's request " +
        "link must be http or https, and its specHash not empty. Every resource is " +
        "checked against its schema before it, or any file with it, is written, and " +
        "errors hide any secret they repeat. readiness needs a review verdict for " +
        "every dimension, and does not count a commented-out or ignored test, or a " +
        "step inside one. render and prefill refuse or flag an app name, entry point " +
        "or checkout path that reads as a secret, since every record would hide it, " +
        "and render checks its record before it writes any file. visibility and " +
        "readiness log what they did not read as a warning, and the viewer logs a " +
        "failed read as one. readiness says when a manifest's visibility: is empty " +
        "or neither private nor public. visibility and readiness take a manifest " +
        "with no visibility: line as public, since the registry publishes it so. " +
        "A draft-rendered pre-flight check (label " +
        "policy) stops result, visibility and readiness on an instance with no " +
        "draft. render writes every file beside its target first and moves them " +
        "into place only when all are written, so a failed write changes no file, " +
        "and a failed move says which files it already moved. result logs where " +
        "it wrote its out file. visibility and readiness read the skills the " +
        "manifest ships under skills:, and list the others as not shipped. render " +
        "writes .github/workflows/ci.yml (the tests and a publish dry run with the " +
        "manifest's visibility) unless the repo already has one. No data " +
        "migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.06.1",
      description:
        "An app spec may have a specification.recipe. prefill carries it over from " +
        "an outcome spec, render drafts a recipe workflow from it, with the spec's " +
        "source url and version in the recipe's tag, and readiness checks that each " +
        "phrase reaches the app, in a throwaway repo. readiness also blocks a recipe " +
        "whose app is too slow for the router, when it can run that app, and an app " +
        "with several steps and no recipe. A build result may list how each example " +
        "phrase went. A secret in a test file goes to a separate secrets-in-tests " +
        "check for a person to look at, not the secrets check. The draft record lists " +
        "only the files render wrote, so not a LICENSE or ci.yml it kept. Each " +
        "method logs its start before any I/O. A secret in config beside the tests, " +
        "like tests/.env, fails the secrets check. An app spec's recipe pieces must " +
        "have different names. readiness accepts no recipe only when a required " +
        "input is free text, and blocks otherwise. result leaves out examples from " +
        "a readiness check older than the latest render. No data migration required.",
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
    visibility: {
      description:
        "The last public-or-private check of an app's repo before publishing: the recommendation, each check and what it found.",
      schema: VisibilitySchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
    readiness: {
      description:
        "The last check that an app is ready to publish: the review's verdicts, each acceptance criterion and its tests, the blockers, and a one-screen summary.",
      schema: ReadinessSchema,
      lifetime: "infinite" as const,
      garbageCollection: 20,
    },
  },
  checks: {
    "draft-rendered": {
      description:
        "Before result, visibility and readiness: this instance has rendered a draft. " +
        "Which app's draft is the method's own check, since checks get no arguments.",
      labels: ["policy"],
      appliesTo: ["result", "visibility", "readiness"],
      execute: async (context: CheckContext): Promise<CheckResult> => {
        let names: string[];
        try {
          names = (await context.dataRepository.findAllForModel(
            context.modelType,
            context.modelId,
          )).map((d) => d.name);
        } catch {
          // The method reads the records too, and says what went wrong.
          return { pass: true };
        }
        const prefixes = Object.values(RESOURCE_PREFIX);
        if (names.some((n) => !prefixes.some((p) => n.startsWith(p)))) {
          return { pass: true };
        }
        return {
          pass: false,
          errors: [
            `No draft has been rendered by this model instance yet, so ${context.methodName} has nothing to work on. ` +
            "Run @puddleworks/puddleworks-factory-build for the spec first.",
          ],
        };
      },
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
      execute: method(async (args: PrefillArgs, context: MethodContext) => {
        const from = sourceLabel(args.outcomeSpec);
        context.logger.info("Prefilling from {source} into {out}", {
          source: from,
          out: args.out,
        });
        context.logger.debug("Reading the outcome spec from {source}", {
          source: from,
        });
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
        const record = checkedResource("prefill", {
          name: spec.name,
          specSource: source,
          out: args.out,
          source: spec.source,
          toDecide,
          warnings,
          prefilledAt: new Date().toISOString(),
        });
        await writeFileIn(args.out, JSON.stringify(spec, null, 2) + "\n");
        context.logger.info("Prefilled {name} from {source} into {out}", {
          name: spec.name,
          source,
          out: args.out,
        });
        const handle = await context.writeResource(
          "prefill",
          `${RESOURCE_PREFIX.prefill}${spec.name}`,
          record,
        );
        return { dataHandles: [handle] };
      }),
    },
    render: {
      description:
        "Write a first draft (extension, tests, workflow, manifest, README, LICENSE, " +
        "ci.yml and CLAUDE.md section) for an app spec, read from a file, an https URL or " +
        "inline JSON, into the root of the app's own repo checkout. Private unless " +
        "visibility=public. An existing LICENSE or ci.yml is kept; other files are not " +
        "overwritten unless overwrite=true.",
      arguments: RenderArgsSchema,
      execute: method(async (args: RenderArgs, context: MethodContext) => {
        const from = sourceLabel(args.spec);
        const root = args.targetDir.replace(/\/+$/, "");
        context.logger.info("Drafting from {source} into {targetDir}", {
          source: from,
          targetDir: root,
        });
        if (safeText(root) !== root) {
          throw new Error(
            "The targetDir path reads as a secret, so every record would hide it. " +
              "Use a checkout path without it.",
          );
        }
        if (!(await exists(`${root}/.swamp.yaml`))) {
          throw new Error(
            `${root} does not look like an app repo checkout: it has no .swamp.yaml. ` +
              "Pass targetDir as the path of a checkout of the app's own swamp repo, e.g. a git worktree of it.",
          );
        }

        context.logger.debug("Reading the app spec from {source}", {
          source: from,
        });
        const { spec, source } = await loadAppSpec(args.spec, io);
        const files = renderDraft(spec, {
          now: new Date(),
          uuid: crypto.randomUUID(),
          repository: args.repository,
          typeScope: context.globalArgs.typeScope,
          visibility: args.visibility,
        });

        // What each file's text becomes, or null to leave it as it is.
        const writes: Array<
          { file: string; path: string; text: string | null }
        > = [];
        const present: string[] = [];
        for (const f of files) {
          const path = `${root}/${f.path}`;
          const old = (await exists(path))
            ? await Deno.readTextFile(path)
            : null;
          const mode = f.existing ?? "replace";
          if (mode === "section") {
            const placed = placeSection(old, f.content);
            if (placed.replaced) present.push(f.path);
            writes.push({ file: f.path, path, text: placed.text });
          } else if (old !== null && mode === "keep") {
            writes.push({ file: f.path, path, text: null });
          } else {
            if (old !== null) present.push(f.path);
            writes.push({ file: f.path, path, text: f.content });
          }
        }
        if (present.length > 0 && !args.overwrite) {
          throw new Error(
            `Refusing to overwrite files that already exist: ${
              present.join(", ")
            }. ` +
              "Pass overwrite=true to replace them.",
          );
        }

        // The record is built and checked before any file is written, so a
        // draft the Factory could not record leaves the checkout as it was.
        const workflow = files[2].path;
        const fit = recipeFit(spec.specification);
        const record = {
          name: spec.name,
          specSource: source,
          ...(spec.source ? { source: spec.source } : {}),
          targetDir: root,
          repository: args.repository,
          visibility: args.visibility,
          modelType: `${context.globalArgs.typeScope}/${spec.name}`,
          entryPointRef: `${context.globalArgs.typeScope}/${
            workflow.slice("workflows/workflow-".length, -".yaml".length)
          }`,
          files: writes.filter((w) => w.text !== null).map((w) => w.file),
          overwrote: present,
          ...(fit
            ? {
              recipe: {
                examples: (spec.specification.recipe?.examples ?? []).map((e) =>
                  e.phrase
                ),
                pieces: (spec.specification.recipe?.pieces ?? []).map((p) =>
                  p.name
                ),
                ...("reason" in fit ? { reason: fit.reason } : {
                  workflow: files.at(-1)!.path,
                }),
              },
            }
            : {}),
          renderedAt: new Date().toISOString(),
        };
        const checked = checkedResource("draft", record);
        const hidden =
          (["name", "targetDir", "modelType", "entryPointRef"] as const)
            .filter((k) => checked[k] !== record[k]);
        if (hidden.length > 0) {
          throw new Error(
            `The draft's ${
              hidden.join(", ")
            } would be hidden as a secret in its record, ` +
              "so nothing was written; pick another name.",
          );
        }

        // Each file is written beside its target first and moved into place
        // only once every one is written, so a write that fails part way
        // leaves the checkout as it was.
        const staged: Array<{ tmp: string; path: string }> = [];
        const stamp = crypto.randomUUID();
        try {
          for (const { path, text } of writes) {
            if (text === null) continue;
            const tmp = `${path}.factory-${stamp}.tmp`;
            staged.push({ tmp, path });
            await writeFileIn(tmp, text);
          }
        } catch (e) {
          await Promise.all(
            staged.map(({ tmp }) => Deno.remove(tmp).catch(() => {})),
          );
          throw new Error(
            `Could not write the draft, so no file was changed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
        const moved: string[] = [];
        for (const { tmp, path } of staged) {
          try {
            await Deno.rename(tmp, path);
          } catch (e) {
            await Promise.all(
              staged.map(({ tmp }) => Deno.remove(tmp).catch(() => {})),
            );
            throw new Error(
              `Could not move ${path.slice(root.length + 1)} into place: ${
                e instanceof Error ? e.message : String(e)
              }. Already written: ${
                moved.join(", ") || "nothing"
              }. Nothing was recorded.`,
            );
          }
          moved.push(path.slice(root.length + 1));
        }

        context.logger.info("Drafted {name} from {source} into {targetDir}", {
          name: spec.name,
          source,
          targetDir: root,
        });
        const handle = await context.writeResource("draft", spec.name, checked);
        return { dataHandles: [handle] };
      }),
    },
    result: {
      description:
        `Write a ${BUILD_RESULT_V1} for the last draft of an app spec: the extension, ` +
        "its entry point, the repository, the branch or commit, the pull request, and " +
        "how each recipe example went. Records it as a resource and, with out, as a " +
        "JSON file.",
      arguments: ResultArgsSchema,
      execute: method(async (args: ResultArgs, context: MethodContext) => {
        context.logger.info("Recording the build result for {name}", {
          name: args.name,
        });
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
        if (!args.publishedVersion !== !args.publishedVisibility) {
          throw new Error(
            "Pass publishedVersion and publishedVisibility together, or neither.",
          );
        }
        const repository = args.repository ?? draft.data.repository;
        if (!repository) {
          throw new Error(
            `The draft of "${args.name}" records no repository. Pass repository.`,
          );
        }
        checkLink("repository", repository, REPO_EXAMPLE);
        if (args.pullRequest) {
          checkLink("pullRequest", args.pullRequest, PR_EXAMPLE);
        }
        // What readiness found, unless the builder says otherwise.
        const readiness = ReadinessSchema.safeParse(
          await context.readResource?.(
            `${RESOURCE_PREFIX.readiness}${args.name}`,
          ),
        );
        // A check from before the latest render was of other phrases.
        const checkedNow = readiness.data &&
          readiness.data.assessedAt > draft.data.renderedAt;
        const examples = args.examples?.length
          ? args.examples
          : checkedNow
          ? readiness.data?.examples
          : undefined;
        const candidate: BuildResult = {
          apiVersion: BUILD_RESULT_V1,
          kind: "BuildResult",
          name: args.name,
          extension: draft.data.modelType,
          entryPointRef: draft.data.entryPointRef,
          repository,
          buildRef: args.buildRef,
          ...(args.pullRequest ? { pullRequest: args.pullRequest } : {}),
          ...(draft.data.source ? { source: draft.data.source } : {}),
          ...(args.publishedVersion && args.publishedVisibility
            ? {
              published: {
                version: args.publishedVersion,
                visibility: args.publishedVisibility,
              },
            }
            : {}),
          ...(examples?.length ? { examples } : {}),
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

        // What the builder passed, like buildRef, may hold a token.
        const result = checkedResource("buildResult", parsed.result);
        if (args.out) {
          await writeFileIn(args.out, JSON.stringify(result, null, 2) + "\n");
          context.logger.info("Wrote the build result for {name} to {out}", {
            name: args.name,
            out: args.out,
          });
        }
        context.logger.info("Build result for {name}: {buildRef}", {
          name: args.name,
          buildRef: args.buildRef,
        });
        const handle = await context.writeResource(
          "buildResult",
          resultName(args.name),
          result,
        );
        return { dataHandles: [handle] };
      }),
    },
    visibility: {
      description:
        "Check the app's repo before publishing and recommend public or private: licence, " +
        "repository and quality must pass to go public; paths, hosts, addresses and emails " +
        "that look internal, or spec wording about who the app is for, recommend private. " +
        "Secrets block public and are never repeated; emails are kept as their domain. " +
        "Records the visibility resource.",
      arguments: VisibilityArgsSchema,
      execute: method(async (args: VisibilityArgs, context: MethodContext) => {
        context.logger.info(
          "Checking whether {name} can be public, in {targetDir}",
          { name: args.name, targetDir: args.targetDir ?? DRAFT_CHECKOUT },
        );
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
        const root = (args.targetDir ?? draft.data.targetDir).replace(
          /\/+$/,
          "",
        );
        context.logger.debug("Scanning {targetDir}", { targetDir: root });
        const { files, notRead } = await textFiles(root);
        warnNotRead(context, notRead);
        const assessment = assessVisibility({
          files,
          notRead,
          quality: args.quality,
          provisionalQuality: args.provisionalQuality,
          repoVisibility: args.repoVisibility,
        });
        context.logger.info("Visibility for {name}: {recommendation}", {
          name: args.name,
          recommendation: assessment.recommendation,
        });
        const handle = await context.writeResource(
          "visibility",
          `${RESOURCE_PREFIX.visibility}${args.name}`,
          {
            name: args.name,
            targetDir: root,
            repoVisibility: args.repoVisibility,
            quality: args.quality,
            provisionalQuality: args.provisionalQuality,
            ...assessment,
            assessedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      }),
    },
    readiness: {
      description:
        "After the independent review, check the app is ready to publish: the review report " +
        "matches the manifest's name and version with no issue or pending verdict, every " +
        "acceptance criterion in spec/ maps to tests that exist or a manual check " +
        "(spec/acceptance.json), and the visibility checks, run again on the files as they " +
        "are now with the quality and repo visibility last given, allow the manifest's " +
        "visibility. If the spec has a recipe, each agreed phrase goes through the recipe " +
        "engine in a throwaway swamp repo, which needs swamp and network access, and " +
        "an app whose manifest says effects-read is run there to time it. " +
        "Records the readiness resource with a one-screen summary.",
      arguments: ReadinessArgsSchema,
      execute: method(async (args: ReadinessArgs, context: MethodContext) => {
        context.logger.info(
          "Checking whether {name} is ready to publish, in {targetDir}",
          { name: args.name, targetDir: args.targetDir ?? DRAFT_CHECKOUT },
        );
        if (args.pullRequest) {
          checkLink("pullRequest", args.pullRequest, PR_EXAMPLE);
        }
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
        const root = (args.targetDir ?? draft.data.targetDir).replace(
          /\/+$/,
          "",
        );
        const reviewFile = args.review.startsWith("/")
          ? args.review
          : `${root}/${args.review}`;
        const reviewText = await exists(reviewFile)
          ? await Deno.readTextFile(reviewFile)
          : null;
        const answer = VisibilityAnswerSchema.safeParse(
          await context.readResource?.(
            `${RESOURCE_PREFIX.visibility}${args.name}`,
          ),
        );
        context.logger.debug("Scanning {targetDir}", { targetDir: root });
        const { files, notRead } = await textFiles(root);
        warnNotRead(context, notRead);
        // The files change after the visibility check (the manifest's
        // visibility, the review report, a late fix): check them again as
        // they are now, with the quality and repo visibility it was given.
        const visibility = !answer.success
          ? null
          : answer.data.quality === undefined || answer.data.targetDir !== root
          ? "outdated" as const
          : assessVisibility({
            files,
            notRead,
            quality: answer.data.quality,
            provisionalQuality: answer.data.provisionalQuality,
            repoVisibility: answer.data.repoVisibility,
          });
        const recipe = await recipeReadiness(
          files,
          draft.data,
          context.runSwamp ?? realSwamp,
          { dir: root },
        );
        const readiness = assessReadiness({
          files,
          recipe,
          review: reviewText === null
            ? null
            : { path: reviewFile, text: reviewText },
          visibility,
          pullRequest: args.pullRequest,
          commit: args.commit,
        });
        context.logger.info("Readiness for {name}: {ready}", {
          name: args.name,
          ready: readiness.ready,
        });
        const handle = await context.writeResource(
          "readiness",
          `${RESOURCE_PREFIX.readiness}${args.name}`,
          {
            name: args.name,
            targetDir: root,
            ...readiness,
            reviewFile,
            pullRequest: args.pullRequest ?? null,
            commit: args.commit ?? null,
            assessedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      }),
    },
  },
};
