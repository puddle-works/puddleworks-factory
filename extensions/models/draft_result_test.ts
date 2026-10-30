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
} from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";
import { parseBuildResult } from "../contracts/build_result_v1.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);

const REPO = "https://github.com/example/my-apps";
const PR = "https://github.com/example/my-apps/pull/42";

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
  spec = EXAMPLE_TEXT,
) {
  const dir = await Deno.makeTempDir({ prefix: "puddle-apps-" });
  try {
    await Deno.writeTextFile(`${dir}/.swamp.yaml`, "tools:\n  - claude\n");
    const ctx = makeContext();
    await model.methods.render.execute(
      {
        spec,
        targetDir: dir,
        repository: REPO,
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
      buildRef: "draft/obsidian-puddle-scanner",
      pullRequest: PR,
    });
  });
});

// The draft already knows its repository, so the result need not be told again.
Deno.test("result: the repository defaults to the draft's", async () => {
  await withDraft(async (_dir, ctx) => {
    const args = model.methods.result.arguments.parse({
      name: "obsidian-puddle-scanner",
      buildRef: "draft/obsidian-puddle-scanner",
    });
    await model.methods.result.execute(args, ctx);
    const written = ctx.store.get("build-result-obsidian-puddle-scanner")!;
    assertEquals(written.repository, REPO);
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

Deno.test("result: an out with no directory writes only that file", async () => {
  await withDraft(async (_dir, ctx) => {
    const cwd = await Deno.makeTempDir({ prefix: "factory-result-" });
    const before = Deno.cwd();
    Deno.chdir(cwd);
    try {
      await model.methods.result.execute(
        resultArgs({ out: "build-result.json" }),
        ctx,
      );
      const names = [];
      for await (const e of Deno.readDir(cwd)) names.push(e.name);
      assertEquals(names, ["build-result.json"]);
    } finally {
      Deno.chdir(before);
      await Deno.remove(cwd, { recursive: true });
    }
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
      ".swamp.yaml",
      "CLAUDE.md",
      "LICENSE",
      "README.md",
      "extensions",
      "manifest.yaml",
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
  assertStringIncludes(err.message, "@puddleworks/puddleworks-factory-build");
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

Deno.test("result: a repository with a login in it writes nothing", async () => {
  await withDraft(async (_dir, ctx) => {
    const before = ctx.writes.length;
    const err = await assertRejects(
      () =>
        model.methods.result.execute(
          resultArgs({
            repository: "https://x-access-token:s3cret@github.com/example/x",
          }),
          ctx,
        ),
      Error,
      "login",
    );
    assertEquals(err.message.includes("s3cret"), false, err.message);
    assertEquals(ctx.writes.length, before);
  });
});

Deno.test("result: carries where the spec was agreed into the build result", async () => {
  const source = {
    url: "http://localhost:3001/requests/8f0c6a52",
    version: 2,
    specHash: "3736f9d3",
  };
  const spec = JSON.stringify({ ...JSON.parse(EXAMPLE_TEXT), source });
  await withDraft(async (_dir, ctx) => {
    await model.methods.result.execute(resultArgs(), ctx);
    const parsed = parseBuildResult(
      ctx.store.get("build-result-obsidian-puddle-scanner"),
    );
    assertEquals(parsed.ok, true, JSON.stringify(parsed));
    if (parsed.ok) assertEquals(parsed.result.source, source);
  }, spec);
});

Deno.test("result: a spec with no source gives a build result with none", async () => {
  await withDraft(async (_dir, ctx) => {
    await model.methods.result.execute(resultArgs(), ctx);
    const data = ctx.store.get("build-result-obsidian-puddle-scanner")!;
    assertEquals("source" in data, false);
  });
});

Deno.test("result: records the published version and visibility", async () => {
  await withDraft(async (_dir, ctx) => {
    await model.methods.result.execute(
      resultArgs({
        publishedVersion: "2026.10.26.1",
        publishedVisibility: "public",
      }),
      ctx,
    );
    const data = ctx.store.get("build-result-obsidian-puddle-scanner")!;
    assertEquals(data.published, {
      version: "2026.10.26.1",
      visibility: "public",
    });
  });
});

Deno.test("result: a published version needs its visibility, and the other way round", async () => {
  await withDraft(async (_dir, ctx) => {
    for (
      const extra of [
        { publishedVersion: "2026.10.26.1" },
        { publishedVisibility: "private" },
      ]
    ) {
      const before = ctx.writes.length;
      const err = await assertRejects(
        () => model.methods.result.execute(resultArgs(extra), ctx),
        Error,
      );
      assertStringIncludes(err.message, "publishedVersion");
      assertStringIncludes(err.message, "publishedVisibility");
      assertEquals(ctx.writes.length, before);
    }
  });
});

Deno.test("result: blank published inputs record nothing published", async () => {
  await withDraft(async (_dir, ctx) => {
    await model.methods.result.execute(
      resultArgs({ publishedVersion: "", publishedVisibility: "" }),
      ctx,
    );
    const data = ctx.store.get("build-result-obsidian-puddle-scanner")!;
    assertEquals("published" in data, false);
  });
});
