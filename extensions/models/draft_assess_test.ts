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

async function withCandidates(
  text: string,
  fn: (file: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "factory-assess-" });
  try {
    await Deno.writeTextFile(`${dir}/candidates.json`, text);
    await fn(`${dir}/candidates.json`);
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
  await withCandidates(JSON.stringify(candidates), async (file) => {
    const ctx = makeContext();
    await run(ctx, { candidates: file });
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
    await withCandidates(text, async (file) => {
      const ctx = makeContext();
      await assertRejects(() => run(ctx, { candidates: file }), Error);
      assertEquals(ctx.writes, []);
    });
  }
});
