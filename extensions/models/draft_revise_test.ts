/**
 * Tests for the draft model's `revise` method: take an app already built to
 * a newly agreed version of its spec, without touching its code.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_revise_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";

const APP_SPEC = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);
const OUTCOME = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../docs/contracts/outcome-spec.v1.example.json",
      import.meta.url,
    ),
  ),
);
const NAME = JSON.parse(APP_SPEC).name as string;
const REPO = `https://github.com/example/${NAME}`;

function makeContext() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { debug: () => {}, info: () => {}, warning: () => {} },
    writeResource(_spec: string, name: string, data: Record<string, unknown>) {
      store.set(name, data);
      return Promise.resolve({ name });
    },
    readResource: (name: string) => Promise.resolve(store.get(name) ?? null),
    store,
  };
}

/** A built app: a draft, both specs at v1 in spec/, and code of its own. */
async function withApp(
  fn: (dir: string, ctx: ReturnType<typeof makeContext>) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "factory-revise-" });
  try {
    await Deno.writeTextFile(`${dir}/.swamp.yaml`, "tools:\n  - claude\n");
    const ctx = makeContext();
    await model.methods.render.execute(
      model.methods.render.arguments.parse({
        spec: APP_SPEC,
        targetDir: dir,
        repository: REPO,
      }),
      ctx,
    );
    await Deno.mkdir(`${dir}/spec`);
    await Deno.writeTextFile(
      `${dir}/spec/outcome-spec.v1.json`,
      JSON.stringify(OUTCOME),
    );
    await Deno.writeTextFile(`${dir}/spec/app-spec.json`, APP_SPEC);
    await fn(dir, ctx);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function v2(edit: (s: Record<string, unknown>) => void = () => {}) {
  const next = structuredClone(OUTCOME);
  next.specification.version = 2;
  next.specification.changeSummary = "Orders go to suppliers now.";
  next.specification.scope.in.push("Sending orders to suppliers");
  next.specification.scope.out = ["Prices and invoices"];
  next.agreement.specHash = "f".repeat(64);
  edit(next);
  return JSON.stringify(next);
}

const run = (ctx: ReturnType<typeof makeContext>, args: object) =>
  model.methods.revise.execute(
    model.methods.revise.arguments.parse({ name: NAME, ...args }),
    ctx,
  );

Deno.test("revise: writes v2 and its plan, and never touches the app's code", async () => {
  await withApp(async (dir, ctx) => {
    const code = `${dir}/extensions/models/${NAME.replaceAll("-", "_")}.ts`;
    const before = await Deno.readTextFile(code);
    const manifest = await Deno.readTextFile(`${dir}/manifest.yaml`);
    await run(ctx, { outcomeSpec: v2() });
    assertEquals(await Deno.readTextFile(code), before);
    assertEquals(await Deno.readTextFile(`${dir}/manifest.yaml`), manifest);
    const saved = JSON.parse(
      await Deno.readTextFile(`${dir}/spec/outcome-spec.v2.json`),
    );
    assertEquals(
      saved.specification.changeSummary,
      "Orders go to suppliers now.",
    );
    const plan = await Deno.readTextFile(`${dir}/spec/change-plan.v2.md`);
    assertStringIncludes(
      plan,
      "- scope.in, added: Sending orders to suppliers",
    );
    assertStringIncludes(plan, "Bump the manifest's version");
  });
});

Deno.test("revise: the app spec and the draft record now meet v2", async () => {
  await withApp(async (dir, ctx) => {
    const purpose = JSON.parse(APP_SPEC).specification.purpose;
    await run(ctx, { outcomeSpec: v2() });
    const app = JSON.parse(
      await Deno.readTextFile(`${dir}/spec/app-spec.json`),
    );
    assertEquals(app.source.version, 2);
    assertEquals(app.source.specHash, "f".repeat(64));
    assertEquals(app.specification.outOfScope, ["Prices and invoices"]);
    assertEquals(app.specification.purpose, purpose);
    const draft = ctx.store.get(NAME)! as { source: { version: number } };
    assertEquals(draft.source.version, 2);
  });
});

Deno.test("revise: refuses another request, and a version that isn't newer", async () => {
  await withApp(async (dir, ctx) => {
    await assertRejects(
      () =>
        run(ctx, {
          outcomeSpec: v2((s) => {
            (s.request as { id: string }).id = "other-request";
          }),
        }),
      Error,
      "is for request other-request",
    );
    await assertRejects(
      () => run(ctx, { outcomeSpec: JSON.stringify(OUTCOME) }),
      Error,
      "already meets version 1",
    );
    assertEquals(
      [...Deno.readDirSync(`${dir}/spec`)].map((e) => e.name).sort(),
      ["app-spec.json", "outcome-spec.v1.json"],
    );
  });
});
