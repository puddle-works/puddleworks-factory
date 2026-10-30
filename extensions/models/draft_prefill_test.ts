/**
 * Tests for the draft model's `prefill` method: write a starter app spec from
 * an agreed outcome spec, for the builder to finish.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_prefill_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";

const OUTCOME_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/outcome-spec.v1.example.json", import.meta.url),
);
const APP_SPEC_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);

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

async function inTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "factory-prefill-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const args = (out: string, overrides: Record<string, unknown> = {}) =>
  model.methods.prefill.arguments.parse({
    outcomeSpec: OUTCOME_TEXT,
    out,
    ...overrides,
  });

Deno.test("prefill: writes a starter app spec to out", async () => {
  await inTempDir(async (dir) => {
    const out = `${dir}/new/app-spec.json`;
    await model.methods.prefill.execute(args(out), makeContext());
    const starter = JSON.parse(await Deno.readTextFile(out));
    assertEquals(starter.apiVersion, "puddleworks.dev/app-spec/v1");
    assertEquals(starter.name, "weekly-stock-count-and-reorder-list");
    assertEquals(starter.source.version, 1);
    assertEquals(starter.delivery.method, "");
  });
});

Deno.test("prefill: an out with no directory writes only that file", async () => {
  await inTempDir(async (dir) => {
    const cwd = Deno.cwd();
    Deno.chdir(dir);
    try {
      await model.methods.prefill.execute(args("app-spec.json"), makeContext());
    } finally {
      Deno.chdir(cwd);
    }
    const names = [];
    for await (const e of Deno.readDir(dir)) names.push(e.name);
    assertEquals(names, ["app-spec.json"]);
  });
});

Deno.test("prefill: records what is left to decide in a prefill resource", async () => {
  await inTempDir(async (dir) => {
    const ctx = makeContext();
    const out = `${dir}/app-spec.json`;
    await model.methods.prefill.execute(args(out), ctx);
    assertEquals(ctx.writes.length, 1);
    const [w] = ctx.writes;
    assertEquals(w.specName, "prefill");
    assertEquals(w.name, "prefill-weekly-stock-count-and-reorder-list");
    assertEquals(w.data.out, out);
    assertEquals(w.data.specSource, "inline");
    assertEquals((w.data.toDecide as string[]).length, 6);
    assertEquals(w.data.warnings, []);
    assertEquals(
      model.resources.prefill.schema.safeParse(w.data).success,
      true,
    );
  });
});

Deno.test("prefill: refuses to replace a starter the builder may have edited", async () => {
  await inTempDir(async (dir) => {
    const out = `${dir}/app-spec.json`;
    await Deno.writeTextFile(out, "edited");
    const ctx = makeContext();
    await assertRejects(
      () => model.methods.prefill.execute(args(out), ctx),
      Error,
      "overwrite=true",
    );
    assertEquals(await Deno.readTextFile(out), "edited");
    assertEquals(ctx.writes.length, 0);
  });
});

Deno.test("prefill: overwrite=true replaces the starter", async () => {
  await inTempDir(async (dir) => {
    const out = `${dir}/app-spec.json`;
    await Deno.writeTextFile(out, "edited");
    await model.methods.prefill.execute(
      args(out, { overwrite: true }),
      makeContext(),
    );
    assertStringIncludes(await Deno.readTextFile(out), "AppSpec");
  });
});

Deno.test("prefill: an app spec is refused and nothing is written", async () => {
  await inTempDir(async (dir) => {
    const out = `${dir}/app-spec.json`;
    const ctx = makeContext();
    await assertRejects(
      () =>
        model.methods.prefill.execute(
          args(out, { outcomeSpec: APP_SPEC_TEXT }),
          ctx,
        ),
      Error,
      "outcome-spec/v1",
    );
    await assertRejects(() => Deno.stat(out));
    assertEquals(ctx.writes.length, 0);
  });
});

Deno.test("prefill: a request link that is not http or https writes nothing", async () => {
  await inTempDir(async (dir) => {
    const outcome = JSON.parse(OUTCOME_TEXT);
    outcome.request.url = "javascript:alert(1)";
    const out = `${dir}/app-spec.json`;
    const ctx = makeContext();
    await assertRejects(
      () =>
        model.methods.prefill.execute(
          args(out, { outcomeSpec: JSON.stringify(outcome) }),
          ctx,
        ),
      Error,
      "request.url",
    );
    assertEquals(ctx.writes, []);
    assertEquals(await Deno.stat(out).then(() => true, () => false), false);
  });
});

Deno.test("prefill: an outcome spec with no spec hash writes nothing", async () => {
  await inTempDir(async (dir) => {
    const outcome = JSON.parse(OUTCOME_TEXT);
    outcome.agreement.specHash = "";
    const out = `${dir}/app-spec.json`;
    const ctx = makeContext();
    await assertRejects(
      () =>
        model.methods.prefill.execute(
          args(out, { outcomeSpec: JSON.stringify(outcome) }),
          ctx,
        ),
      Error,
      "agreement.specHash",
    );
    assertEquals(ctx.writes, []);
    assertEquals(await Deno.stat(out).then(() => true, () => false), false);
  });
});
