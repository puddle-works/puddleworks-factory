/**
 * Tests for the recipe the draft model writes beside a new app, and how
 * readiness and the build result report it.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_recipe_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/yaml@1.0.12";
import { model, renderDraft } from "./draft.ts";
import { DRAFT_LINE, recipeFromWorkflow } from "../lib/recipes.ts";
import { parseAppSpec } from "../contracts/app_spec_v1.ts";
import { REVIEW_DIMENSIONS } from "../lib/readiness.ts";

const EXAMPLE = JSON.parse(
  await Deno.readTextFile(
    new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
  ),
);
const REPO = "https://github.com/example/my-app";
const REVIEW = "swamp-extension-review/report.json";

function spec(over: Record<string, unknown> = {}) {
  return {
    ...EXAMPLE,
    name: "my-app",
    delivery: { method: "packaged_script" },
    specification: {
      ...EXAMPLE.specification,
      settings: [],
      inputs: [{
        name: "number",
        type: "integer",
        description: "The issue.",
        required: true,
      }, {
        name: "verbose",
        type: "boolean",
        description: "More.",
        required: false,
        default: false,
      }],
      output: "Each issue's {title}, one line each",
      recipe: {
        examples: [
          { phrase: "show issue 42?", answer: "Its title." },
          { phrase: "what's in issue 7", answer: "Its title." },
        ],
        pieces: [{ name: "number", shape: "int" }],
        whenEmpty: "No such issue.",
      },
      ...over,
    },
  };
}

function render(input: Record<string, unknown>) {
  const parsed = parseAppSpec(input);
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return renderDraft(parsed.spec, {
    now: new Date("2026-11-05T12:00:00Z"),
    uuid: "11111111-1111-4111-8111-111111111111",
    recipeUuid: "22222222-2222-4222-8222-222222222222",
    repository: REPO,
  });
}

const fileOf = (files: ReturnType<typeof render>, path: string) =>
  files.find((f) => f.path === path)?.content;
const RECIPE_FILE = "workflows/workflow-my-app-recipe.yaml";

Deno.test("recipe draft: a spec that fits gets a recipe workflow the engine accepts", () => {
  const files = render(spec());
  const text = fileOf(files, RECIPE_FILE)!;
  const workflow = parse(text) as Record<string, unknown> & {
    tags: Record<string, string>;
    inputs: unknown;
  };
  assertEquals(workflow.id, "22222222-2222-4222-8222-222222222222");
  assertEquals(workflow.name, "@puddleworks/my-app-recipe");
  assertEquals(workflow.tags.maxReruns, "3");
  assertEquals(workflow.tags.maxWallClock, "1m");
  const read = recipeFromWorkflow(workflow);
  if (!("recipe" in read)) throw new Error(read.error);
  const recipe = read.recipe as Record<string, unknown> & {
    pattern: string;
    each: { path: string; line: string };
  };
  assertEquals(recipe.id, "my-app");
  assertEquals(recipe.extension, "@puddleworks/my-app");
  assertEquals(recipe.method, "run");
  assertEquals(recipe.definition, "my-app-model");
  assertEquals(recipe.dataName, "result");
  assertEquals(recipe.inputs, { number: { capture: 1, as: "int" } });
  assertEquals(recipe.fixed, {});
  assertEquals(recipe.empty, "No such issue.");
  assertEquals(recipe.each, { path: "items", line: DRAFT_LINE });
  assertEquals(recipe.template, "Each issue's title, one line each\n{lines}");
  for (const phrase of ["show issue 42?", "what's in issue 7"]) {
    assertEquals(
      new RegExp(`^(?:${recipe.pattern})$`, "i").test(phrase),
      true,
      phrase,
    );
  }
  // The optional input stays out: the method's default applies.
  assertEquals(text.includes("verbose"), false);
});

Deno.test("recipe draft: a blank whenEmpty leaves empty out", () => {
  const s = spec();
  s.specification.recipe.whenEmpty = "   ";
  const workflow = parse(fileOf(render(s), RECIPE_FILE)!) as {
    tags: Record<string, string>;
  };
  assertEquals("empty" in JSON.parse(workflow.tags.puddlerouterRecipe), false);
});

Deno.test("recipe draft: the manifest lists it and carries the label", () => {
  const manifest = parse(fileOf(render(spec()), "manifest.yaml")!) as {
    labels: string[];
    workflows: string[];
  };
  assertEquals(manifest.labels, ["puddlerouter-recipe"]);
  assertEquals(manifest.workflows, [
    "workflow-my-app.yaml",
    "workflow-my-app-recipe.yaml",
  ]);
});

Deno.test("recipe draft: CLAUDE.md says how to finish it and when to remove it", () => {
  const claude = fileOf(render(spec()), "CLAUDE.md")!.replace(/\s+/g, " ");
  for (
    const part of [
      RECIPE_FILE,
      "each.line",
      '"show issue 42?"',
      "must not drop",
      "several steps",
      "manifest",
      "puddlerouter-recipe",
    ]
  ) assertStringIncludes(claude, part);
});

Deno.test("recipe draft: the entry workflow stays the third file, and no recipe changes nothing", () => {
  const { recipe: _r, ...without } = spec().specification;
  const plain = render({ ...spec(), specification: without });
  assertEquals(plain.some((f) => f.path.includes("recipe")), false);
  const manifest = fileOf(plain, "manifest.yaml")!;
  assertEquals(manifest.includes("labels"), false);
  assertEquals(fileOf(plain, "CLAUDE.md")!.includes("Recipe"), false);
  assertEquals(render(spec())[2].path, "workflows/workflow-my-app.yaml");
});

Deno.test("recipe draft: a spec that doesn't fit gets no recipe, and CLAUDE.md says why", () => {
  const files = render(spec({
    inputs: [{
      name: "note",
      type: "string",
      description: "Free text.",
      required: true,
    }],
    recipe: {
      examples: [{ phrase: "take a note", answer: "" }],
      pieces: [],
      whenEmpty: "",
    },
  }));
  assertEquals(fileOf(files, RECIPE_FILE), undefined);
  assertEquals(fileOf(files, "manifest.yaml")!.includes("labels"), false);
  assertStringIncludes(fileOf(files, "CLAUDE.md")!, '"note"');
});

// ---------------------------------------------------------------------------
// Through the model
// ---------------------------------------------------------------------------

function makeContext(swampCalls: string[][] = []) {
  const store = new Map<string, Record<string, unknown>>();
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { debug: () => {}, info: () => {}, warning: () => {} },
    writeResource(
      _spec: string,
      name: string,
      data: Record<string, unknown>,
    ) {
      store.set(name, data);
      return Promise.resolve({ name });
    },
    readResource: (name: string) => Promise.resolve(store.get(name) ?? null),
    store,
    runSwamp: (args: string[]) => {
      swampCalls.push(args);
      const attributes = args.includes("match")
        ? {
          matched: true,
          recipeId: "my-app",
          captures: ["42"],
          effects: "write",
        }
        : { action: "would-ask", ok: true, text: "Would ask.", error: "" };
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ dataArtifacts: [{ attributes }] }),
        stderr: "",
      });
    },
  };
}

async function drafted(
  input: Record<string, unknown>,
  fn: (dir: string, ctx: ReturnType<typeof makeContext>) => Promise<void>,
  swampCalls: string[][] = [],
) {
  const dir = await Deno.makeTempDir({ prefix: "factory-recipe-" });
  try {
    await Deno.writeTextFile(`${dir}/.swamp.yaml`, "tools:\n  - claude\n");
    const ctx = makeContext(swampCalls);
    await model.methods.render.execute(
      model.methods.render.arguments.parse({
        spec: JSON.stringify(input),
        targetDir: dir,
        repository: REPO,
      }),
      ctx,
    );
    await fn(dir, ctx);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const readinessOf = async (
  dir: string,
  ctx: ReturnType<typeof makeContext>,
) => {
  const manifest = await Deno.readTextFile(`${dir}/manifest.yaml`);
  await Deno.mkdir(`${dir}/swamp-extension-review`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/${REVIEW}`,
    JSON.stringify({
      extension: "@puddleworks/my-app",
      version: manifest.match(/^version: "(.+)"$/m)![1],
      reviewedAt: "2026-10-26T16:00:00Z",
      dimensions: REVIEW_DIMENSIONS.map((id) => ({ id, verdict: "pass" })),
    }),
  );
  await model.methods.visibility.execute(
    model.methods.visibility.arguments.parse({
      name: "my-app",
      quality: 100,
      repoVisibility: "private",
    }),
    ctx,
  );
  await model.methods.readiness.execute(
    model.methods.readiness.arguments.parse({ name: "my-app", review: REVIEW }),
    ctx,
  );
  return ctx.store.get("readiness-my-app")! as Record<string, unknown> & {
    blockers: string[];
    summary: string;
  };
};

const finish = async (dir: string) => {
  const path = `${dir}/${RECIPE_FILE}`;
  const text = await Deno.readTextFile(path);
  await Deno.writeTextFile(path, text.replace(DRAFT_LINE, "{title}"));
};

Deno.test("recipe through the model: render records the recipe it wrote", async () => {
  await drafted(spec(), async (dir, ctx) => {
    assertEquals(ctx.store.get("my-app")!.recipe, {
      examples: ["show issue 42?", "what's in issue 7"],
      pieces: ["number"],
      workflow: RECIPE_FILE,
    });
    assertEquals(
      (ctx.store.get("my-app")!.files as string[]).includes(RECIPE_FILE),
      true,
    );
    await Deno.stat(`${dir}/${RECIPE_FILE}`);
    assertStringIncludes(
      ctx.store.get("my-app")!.entryPointRef as string,
      "@puddleworks/my-app",
    );
    assertEquals(
      ctx.store.get("my-app")!.entryPointRef,
      "@puddleworks/my-app",
    );
  });
});

Deno.test("recipe through the model: render records why there is no recipe", async () => {
  const s = spec({ inputs: [] });
  await drafted(s, (_dir, ctx) => {
    const recipe = ctx.store.get("my-app")!.recipe as {
      reason: string;
      workflow?: string;
    };
    assertEquals(recipe.workflow, undefined);
    assertStringIncludes(recipe.reason, '"number"');
    return Promise.resolve();
  });
});

Deno.test("recipe through the model: readiness checks it and the build result reports it", async () => {
  const calls: string[][] = [];
  await drafted(spec(), async (dir, ctx) => {
    await finish(dir);
    const readiness = await readinessOf(dir, ctx);
    assertEquals(readiness.blockers, []);
    assertEquals(readiness.examples, [
      { phrase: "show issue 42?", passed: true },
      { phrase: "what's in issue 7", passed: true },
    ]);
    assertEquals(readiness.recipe, "2 of 2 example phrases passed");
    assertStringIncludes(
      readiness.summary,
      "Recipe: 2 of 2 example phrases passed",
    );
    await model.methods.result.execute(
      model.methods.result.arguments.parse({
        name: "my-app",
        buildRef: "draft/my-app",
      }),
      ctx,
    );
    assertEquals(
      ctx.store.get("build-result-my-app")!.examples,
      readiness.examples,
    );
  }, calls);
  assertEquals(calls.filter((c) => c.includes("match")).length, 2);
});

Deno.test("recipe through the model: the draft's each.line left in blocks readiness", async () => {
  await drafted(spec(), async (dir, ctx) => {
    const readiness = await readinessOf(dir, ctx);
    assertStringIncludes(readiness.blockers.join(" "), "each.line");
  });
});

Deno.test("recipe through the model: no recipe leaves examples out, and says why", async () => {
  const calls: string[][] = [];
  await drafted(spec({ inputs: [] }), async (dir, ctx) => {
    const readiness = await readinessOf(dir, ctx);
    assertEquals(readiness.blockers, []);
    assertEquals("examples" in readiness, false);
    assertStringIncludes(readiness.recipe as string, '"number"');
    assertStringIncludes(readiness.summary, "Recipe: none.");
    await model.methods.result.execute(
      model.methods.result.arguments.parse({
        name: "my-app",
        buildRef: "draft/my-app",
      }),
      ctx,
    );
    assertEquals("examples" in ctx.store.get("build-result-my-app")!, false);
  }, calls);
  assertEquals(calls, []);
});

Deno.test("recipe through the model: examples the builder passes still win", async () => {
  await drafted(spec(), async (dir, ctx) => {
    await finish(dir);
    await readinessOf(dir, ctx);
    const given = [{ phrase: "show issue 42?", passed: false, detail: "No." }];
    await model.methods.result.execute(
      model.methods.result.arguments.parse({
        name: "my-app",
        buildRef: "draft/my-app",
        examples: given,
      }),
      ctx,
    );
    assertEquals(ctx.store.get("build-result-my-app")!.examples, given);
  });
});

Deno.test("recipe through the model: a spec without a recipe never starts swamp", async () => {
  const calls: string[][] = [];
  const { recipe: _r, ...without } = spec().specification;
  await drafted({ ...spec(), specification: without }, async (dir, ctx) => {
    const readiness = await readinessOf(dir, ctx);
    assertEquals(readiness.blockers, []);
    assertEquals(readiness.recipe, null);
    assertEquals(readiness.summary.includes("Recipe"), false);
  }, calls);
  assertEquals(calls, []);
});
