/**
 * Tests for the draft model's `readiness` method: after the independent
 * review, say whether the app is ready to publish and summarise it on one
 * screen.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_readiness_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);

const REPO = "https://github.com/example/obsidian-puddle-scanner";
const NAME = "obsidian-puddle-scanner";
const REVIEW = "swamp-extension-review/report.json";

/** A context that keeps what is written, so a later method can read it. */
function makeContext() {
  const store = new Map<string, Record<string, unknown>>();
  const writes: Array<{ specName: string; name: string }> = [];
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { info: () => {} },
    writeResource(
      specName: string,
      name: string,
      data: Record<string, unknown>,
    ) {
      writes.push({ specName, name });
      store.set(name, data);
      return Promise.resolve({ name });
    },
    readResource(name: string) {
      return Promise.resolve(store.get(name) ?? null);
    },
    store,
    writes,
  };
}

/** Render the example spec, check visibility, and write a complete review. */
async function withReviewedDraft(
  fn: (dir: string, ctx: ReturnType<typeof makeContext>) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "factory-readiness-" });
  try {
    await Deno.writeTextFile(`${dir}/.swamp.yaml`, "tools:\n  - claude\n");
    const ctx = makeContext();
    await model.methods.render.execute(
      model.methods.render.arguments.parse({
        spec: EXAMPLE_TEXT,
        targetDir: dir,
        repository: REPO,
      }),
      ctx,
    );
    await model.methods.visibility.execute(
      model.methods.visibility.arguments.parse({
        name: NAME,
        quality: 100,
        repoVisibility: "private",
      }),
      ctx,
    );
    const manifest = await Deno.readTextFile(`${dir}/manifest.yaml`);
    const version = manifest.match(/^version: "(.+)"$/m)![1];
    await Deno.mkdir(`${dir}/swamp-extension-review`);
    await Deno.writeTextFile(
      `${dir}/${REVIEW}`,
      JSON.stringify({
        extension: `@puddleworks/${NAME}`,
        version,
        reviewedAt: "2026-10-26T16:00:00Z",
        dimensions: [{ id: "credentials-secrets", verdict: "pass" }],
      }),
    );
    await fn(dir, ctx);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const args = (overrides: Record<string, unknown> = {}) =>
  model.methods.readiness.arguments.parse({
    name: NAME,
    review: REVIEW,
    ...overrides,
  });

Deno.test("readiness: a reviewed draft from an app spec is ready", async () => {
  await withReviewedDraft(async (dir, ctx) => {
    await model.methods.readiness.execute(
      args({ pullRequest: `${REPO}/pull/1`, commit: "0123456789abcdef" }),
      ctx,
    );
    const last = ctx.writes.at(-1)!;
    assertEquals(last.specName, "readiness");
    assertEquals(last.name, `readiness-${NAME}`);
    const data = ctx.store.get(last.name)!;
    assertEquals(data.name, NAME);
    assertEquals(data.targetDir, dir);
    assertEquals(data.ready, true, String(data.summary));
    assertEquals(data.package, `@puddleworks/${NAME}`);
    assertEquals(data.visibility, "private");
    assertEquals(data.recommendation, "public");
    assertEquals(data.reviewFile, `${dir}/${REVIEW}`);
    assertEquals(data.pullRequest, `${REPO}/pull/1`);
    assertEquals(data.commit, "0123456789abcdef");
    assertStringIncludes(String(data.summary), "Ready to publish: yes");
    assertStringIncludes(String(data.summary), `${REPO}/pull/1`);
  });
});

Deno.test("readiness: an absolute review path is read as given", async () => {
  await withReviewedDraft(async (dir, ctx) => {
    await model.methods.readiness.execute(
      args({ review: `${dir}/${REVIEW}` }),
      ctx,
    );
    assertEquals(ctx.store.get(`readiness-${NAME}`)!.ready, true);
  });
});

Deno.test("readiness: a review report that is not there blocks", async () => {
  await withReviewedDraft(async (_dir, ctx) => {
    await model.methods.readiness.execute(
      args({ review: "swamp-extension-review/missing.json" }),
      ctx,
    );
    const data = ctx.store.get(`readiness-${NAME}`)!;
    assertEquals(data.ready, false);
    assertEquals(data.review, null);
  });
});

Deno.test("readiness: criteria in spec/ must be mapped to tests that exist", async () => {
  await withReviewedDraft(async (dir, ctx) => {
    await Deno.mkdir(`${dir}/spec`);
    await Deno.writeTextFile(
      `${dir}/spec/outcome-spec.v1.json`,
      JSON.stringify({
        specification: {
          version: 1,
          acceptanceCriteria: [{ id: "AC1", text: "Lists open tasks" }],
        },
      }),
    );
    await model.methods.readiness.execute(args(), ctx);
    assertEquals(ctx.store.get(`readiness-${NAME}`)!.ready, false);

    const tests = await Array.fromAsync(
      Deno.readDir(`${dir}/extensions/models`),
    );
    const testFile = tests.find((e) => e.name.endsWith("_test.ts"))!.name;
    const text = await Deno.readTextFile(
      `${dir}/extensions/models/${testFile}`,
    );
    const first = text.match(/Deno\.test\(\s*"([^"]+)"/)![1];
    await Deno.writeTextFile(
      `${dir}/spec/acceptance.json`,
      JSON.stringify({ criteria: [{ id: "AC1", tests: [first] }] }),
    );
    await model.methods.readiness.execute(args(), ctx);
    const data = ctx.store.get(`readiness-${NAME}`)!;
    assertEquals(data.ready, true, String(data.summary));
  });
});

Deno.test("readiness: with no visibility check it is not ready", async () => {
  await withReviewedDraft(async (_dir, ctx) => {
    ctx.store.delete(`visibility-${NAME}`);
    await model.methods.readiness.execute(args(), ctx);
    const data = ctx.store.get(`readiness-${NAME}`)!;
    assertEquals(data.ready, false);
    assertEquals(data.recommendation, null);
  });
});

Deno.test("readiness: with no draft for the name it says what to run", async () => {
  const ctx = makeContext();
  const err = await assertRejects(
    () => model.methods.readiness.execute(args(), ctx),
    Error,
  );
  assertStringIncludes(err.message, NAME);
  assertStringIncludes(err.message, "@puddleworks/puddleworks-factory-build");
  assertEquals(ctx.writes.length, 0);
});

Deno.test("readiness: a pull request with a login or query writes nothing", async () => {
  await withReviewedDraft(async (_dir, ctx) => {
    const before = ctx.writes.length;
    const err = await assertRejects(
      () =>
        model.methods.readiness.execute(
          args({ pullRequest: `${REPO}/pull/1?token=SEKRET_PR2` }),
          ctx,
        ),
      Error,
      "pullRequest",
    );
    assertEquals(err.message.includes("SEKRET_PR2"), false, err.message);
    assertEquals(ctx.writes.length, before);
  });
});

// The visibility record is from before the change: readiness checks the
// files as they are now, with the quality and repo visibility it recorded.
Deno.test("readiness: a secret added after the visibility check blocks public", async () => {
  await withReviewedDraft(async (dir, ctx) => {
    const manifest = await Deno.readTextFile(`${dir}/manifest.yaml`);
    await Deno.writeTextFile(
      `${dir}/manifest.yaml`,
      manifest.replace(/^visibility: private$/m, "visibility: public"),
    );
    await Deno.writeTextFile(
      `${dir}/extensions/models/leak.ts`,
      `export const token = "${["ghp_", "k".repeat(36)].join("")}";\n`,
    );
    await model.methods.readiness.execute(args(), ctx);
    const data = ctx.store.get(`readiness-${NAME}`)!;
    assertEquals(data.ready, false, String(data.summary));
    assertEquals(data.recommendation, "private");
    assertStringIncludes(String(data.blockers), "required checks failed");
  });
});

Deno.test("readiness: a visibility check of another checkout, or by an older Factory, is run again", async () => {
  await withReviewedDraft(async (dir, ctx) => {
    const name = `visibility-${NAME}`;
    const { quality: _q, ...older } = ctx.store.get(name)!;
    for (
      const record of [older, {
        ...ctx.store.get(name)!,
        targetDir: "/elsewhere",
      }]
    ) {
      ctx.store.set(name, record);
      await model.methods.readiness.execute(args({ targetDir: dir }), ctx);
      const data = ctx.store.get(`readiness-${NAME}`)!;
      assertEquals(data.ready, false, String(data.summary));
      assertStringIncludes(
        String(data.blockers),
        "run @puddleworks/puddleworks-factory-visibility again",
      );
    }
  });
});
