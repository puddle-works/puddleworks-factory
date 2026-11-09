/**
 * Tests for the draft model's `assess` method: record what an outcome needs
 * built before anything is drafted.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_assess_test.ts
 *
 * @module
 */
import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";

const OUTCOME = await Deno.readTextFile(
  new URL("../../docs/contracts/outcome-spec.v1.example.json", import.meta.url),
);

function makeContext() {
  const writes: Array<{ specName: string; name: string; data: unknown }> = [];
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { debug: () => {}, info: () => {}, warning: () => {} },
    writeResource(specName: string, name: string, data: unknown) {
      writes.push({ specName, name, data });
      return Promise.resolve({ name });
    },
    readResource: () => Promise.resolve(null),
    writes,
  };
}

const NONE_MATCHED = JSON.stringify([
  { phrase: "what needs reordering this week", recipe: null },
  { phrase: "what should I reorder", recipe: null },
]);

async function withCandidates(
  text: string,
  fn: (file: string, matches: string) => Promise<void>,
  matches = NONE_MATCHED,
) {
  const dir = await Deno.makeTempDir({ prefix: "factory-assess-" });
  try {
    await Deno.writeTextFile(`${dir}/candidates.json`, text);
    await Deno.writeTextFile(`${dir}/matches.json`, matches);
    await fn(`${dir}/candidates.json`, `${dir}/matches.json`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const run = (ctx: ReturnType<typeof makeContext>, args: object) =>
  model.methods.assess.execute(
    model.methods.assess.arguments.parse({
      outcomeSpec: OUTCOME,
      delivery: "packaged_script",
      ...args,
    }),
    ctx,
  );

Deno.test("assess: records the verdict under the request's title as a slug", async () => {
  const candidates = [{
    extension: "@webframp/github",
    type: "@webframp/github",
    method: "get_repo_info",
    checks: {
      wholeJob: false,
      readOnly: true,
      inputs: true,
      settings: true,
      output: false,
    },
    note: "No file path in the answer",
  }];
  await withCandidates(JSON.stringify(candidates), async (file, matches) => {
    const ctx = makeContext();
    await run(ctx, { candidates: file, matches });
    const [w] = ctx.writes;
    assertEquals(w.specName, "assessment");
    assertEquals(
      w.name,
      "assessment-weekly-stock-count-and-reorder-list",
    );
    const data = w.data as Record<string, unknown> & {
      candidates: Array<{ failed: string[]; owner: string; note: string }>;
    };
    assertEquals(data.verdict, "build-functionality");
    assertEquals(data.candidates[0].failed, ["wholeJob", "output"]);
    assertEquals(data.candidates[0].owner, "external");
    assertEquals(data.candidates[0].note, "No file path in the answer");
  });
});

Deno.test("assess: refuses candidates that aren't a list of them", async () => {
  for (const text of ["not json", '[{"extension":"@a/b"}]', "{}"]) {
    await withCandidates(text, async (file, matches) => {
      const ctx = makeContext();
      await assertRejects(() => run(ctx, { candidates: file, matches }), Error);
      assertEquals(ctx.writes, []);
    });
  }
});

Deno.test("assess: done needs a match result for every example phrasing", async () => {
  const one = JSON.stringify([
    { phrase: "what needs reordering this week", recipe: "reorder-list" },
  ]);
  await withCandidates("[]", async (file, matches) => {
    const ctx = makeContext();
    await assertRejects(
      () => run(ctx, { candidates: file, matches }),
      Error,
      '"what should I reorder"',
    );
    await assertRejects(
      () => run(ctx, { candidates: file }),
      Error,
      "No match result",
    );
    assertEquals(ctx.writes, []);
  }, one);
});

Deno.test("assess: an existing recipe for every phrasing is done", async () => {
  const both = JSON.stringify([
    {
      phrase: "what needs reordering this week",
      recipe: "reorder-list",
      extension: "@puddleworks/stock",
    },
    {
      phrase: "what should I reorder",
      recipe: "reorder-list",
      extension: "@puddleworks/stock",
    },
  ]);
  await withCandidates("[]", async (file, matches) => {
    const ctx = makeContext();
    await run(ctx, { candidates: file, matches });
    const data = ctx.writes[0].data as { verdict: string; matches: unknown[] };
    assertEquals(data.verdict, "done");
    assertEquals(data.matches.length, 2);
  }, both);
});
