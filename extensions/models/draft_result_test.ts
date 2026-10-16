/**
 * Tests for the draft model's `result` method: after a build, write a
 * puddleworks.dev/build-result/v1 that says what was built and where.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_result_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { model } from "./draft.ts";
import { parseBuildResult } from "../contracts/build_result_v1.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);

const REPO = "https://github.com/puddle-works/puddleworks-apps";
const PR = "https://github.com/puddle-works/puddleworks-apps/pull/42";

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

async function withDraft(
  fn: (dir: string, ctx: ReturnType<typeof makeContext>) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "puddle-apps-" });
  try {
    await Deno.mkdir(`${dir}/extensions/models`, { recursive: true });
    const ctx = makeContext();
    await model.methods.render.execute(
      {
        spec: EXAMPLE_TEXT,
        targetDir: dir,
        overwrite: false,
        visibility: "public",
      },
      ctx,
    );
    await fn(dir, ctx);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function resultArgs(overrides: Record<string, unknown> = {}) {
  return model.methods.result.arguments.parse({
    name: "obsidian-puddle-scanner",
    repository: REPO,
    buildRef: "draft/obsidian-puddle-scanner",
    pullRequest: PR,
    ...overrides,
  });
}

Deno.test("result: records a build-result/v1 for the last draft", async () => {
  await withDraft(async (_dir, ctx) => {
    await model.methods.result.execute(resultArgs(), ctx);
    const last = ctx.writes.at(-1)!;
    assertEquals(last.specName, "buildResult");
    assertEquals(last.name, "build-result-obsidian-puddle-scanner");
    const parsed = parseBuildResult(ctx.store.get(last.name));
    assertEquals(parsed.ok, true, JSON.stringify(parsed));
    if (!parsed.ok) return;
    const { builtAt: _b, ...rest } = parsed.result;
    assertEquals(rest, {
      apiVersion: "puddleworks.dev/build-result/v1",
      kind: "BuildResult",
      name: "obsidian-puddle-scanner",
      extension: "@puddleworks/obsidian-puddle-scanner",
      entryPointRef: "@puddleworks/obsidian-scan",
      repository: REPO,
      path: "puddles/obsidian-puddle-scanner",
      buildRef: "draft/obsidian-puddle-scanner",
      pullRequest: PR,
    });
  });
});

Deno.test("result: out writes the same build result to a file", async () => {
  await withDraft(async (dir, ctx) => {
    const out = `${dir}/out/build-result.json`;
    await model.methods.result.execute(resultArgs({ out }), ctx);
    const written = JSON.parse(await Deno.readTextFile(out));
    assertEquals(
      written,
      ctx.store.get("build-result-obsidian-puddle-scanner"),
    );
  });
});

Deno.test("result: a blank pull request or out is left out", async () => {
  await withDraft(async (dir, ctx) => {
    await model.methods.result.execute(
      resultArgs({ pullRequest: "", out: "" }),
      ctx,
    );
    const data = ctx.store.get("build-result-obsidian-puddle-scanner")!;
    assertEquals("pullRequest" in data, false);
    assertEquals([...Deno.readDirSync(dir)].map((e) => e.name).sort(), [
      "extensions",
      "puddles",
      "workflows",
    ]);
  });
});

Deno.test("result: with no draft for the name it says what to run", async () => {
  const ctx = makeContext();
  const err = await assertRejects(
    () => model.methods.result.execute(resultArgs(), ctx),
    Error,
  );
  assertStringIncludes(err.message, "obsidian-puddle-scanner");
  assertStringIncludes(err.message, "@mesgme/puddleworks-factory-build");
  assertEquals(ctx.writes.length, 0);
});

Deno.test("result: a link that is not https writes nothing", async () => {
  await withDraft(async (_dir, ctx) => {
    const before = ctx.writes.length;
    const err = await assertRejects(
      () =>
        model.methods.result.execute(
          resultArgs({ repository: "git@github.com:puddle-works/x.git" }),
          ctx,
        ),
      Error,
    );
    assertStringIncludes(err.message, "repository");
    assertEquals(ctx.writes.length, before);
  });
});
