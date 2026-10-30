/**
 * Tests for the draft model's `visibility` method: before publishing, check
 * the app's repo and recommend sharing it publicly or keeping it private.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_visibility_test.ts
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
  const dir = await Deno.makeTempDir({ prefix: "factory-visibility-" });
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
    await fn(dir, ctx);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const args = (overrides: Record<string, unknown> = {}) =>
  model.methods.visibility.arguments.parse({
    name: NAME,
    quality: 100,
    repoVisibility: "private",
    ...overrides,
  });

Deno.test("visibility: a fresh draft is recommended public", async () => {
  await withDraft(async (dir, ctx) => {
    await model.methods.visibility.execute(args(), ctx);
    const last = ctx.writes.at(-1)!;
    assertEquals(last.specName, "visibility");
    assertEquals(last.name, `visibility-${NAME}`);
    const data = ctx.store.get(last.name)!;
    assertEquals(data.name, NAME);
    assertEquals(data.targetDir, dir);
    assertEquals(data.recommendation, "public", JSON.stringify(data));
    assertEquals(data.canBePublic, true);
    assertEquals(data.manifestVisibility, "private");
    assertEquals(data.repoVisibility, "private");
    assertEquals(data.findings, []);
  });
});

Deno.test("visibility: reads the repo's files, not .git or .swamp", async () => {
  await withDraft(async (dir, ctx) => {
    for (const d of [".git", ".swamp"]) {
      await Deno.mkdir(`${dir}/${d}`);
      await Deno.writeTextFile(`${dir}/${d}/notes`, "/Users/alice/x/\n");
    }
    await Deno.mkdir(`${dir}/spec`);
    await Deno.writeTextFile(
      `${dir}/spec/outcome-spec.v1.json`,
      JSON.stringify({
        specification: { constraints: ["For our team only"] },
      }),
    );
    await model.methods.visibility.execute(args(), ctx);
    const data = ctx.store.get(`visibility-${NAME}`)!;
    assertEquals(data.recommendation, "private");
    assertEquals(
      (data.findings as Array<{ file: string }>).map((f) => f.file),
      ["spec/outcome-spec.v1.json"],
    );
  });
});

Deno.test("visibility: says which files it did not read", async () => {
  await withDraft(async (dir, ctx) => {
    await Deno.mkdir(`${dir}/.claude/skills/app`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.claude/skills/app/SKILL.md`, "# app\n");
    await Deno.mkdir(`${dir}/data`);
    await Deno.writeTextFile(`${dir}/data/big.json`, "x".repeat(600 * 1024));
    await Deno.writeFile(`${dir}/data/logo.png`, new Uint8Array([137, 0, 1]));
    await model.methods.visibility.execute(args(), ctx);
    const data = ctx.store.get(`visibility-${NAME}`)!;
    const secrets = (data.checks as Array<{ id: string; detail: string }>)
      .find((c) => c.id === "secrets")!;
    assertStringIncludes(
      secrets.detail,
      "not read: .claude/skills/, data/big.json (over 512 KB), data/logo.png (binary)",
    );
  });
});

Deno.test("visibility: lists symlinks it did not follow", async () => {
  await withDraft(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/outside.env`, "PW=x\n");
    await Deno.mkdir(`${dir}/config`);
    await Deno.symlink(`${dir}/outside.env`, `${dir}/config/prod.env`);
    await model.methods.visibility.execute(args(), ctx);
    const data = ctx.store.get(`visibility-${NAME}`)!;
    const secrets = (data.checks as Array<{ id: string; detail: string }>)
      .find((c) => c.id === "secrets")!;
    assertStringIncludes(secrets.detail, "config/prod.env (symlink)");
  });
});

Deno.test("visibility: targetDir overrides where the draft was written", async () => {
  await withDraft(async (_dir, ctx) => {
    const other = await Deno.makeTempDir({ prefix: "factory-visibility-" });
    try {
      await model.methods.visibility.execute(args({ targetDir: other }), ctx);
      const data = ctx.store.get(`visibility-${NAME}`)!;
      assertEquals(data.targetDir, other);
      assertEquals(data.manifestVisibility, null);
      assertEquals(data.canBePublic, false);
    } finally {
      await Deno.remove(other, { recursive: true });
    }
  });
});

Deno.test("visibility: with no draft for the name it says what to run", async () => {
  const ctx = makeContext();
  const err = await assertRejects(
    () => model.methods.visibility.execute(args(), ctx),
    Error,
  );
  assertStringIncludes(err.message, NAME);
  assertStringIncludes(err.message, "@puddleworks/puddleworks-factory-build");
  assertEquals(ctx.writes.length, 0);
});

Deno.test("visibility: quality is a percentage", () => {
  for (const quality of [-1, 101, 99.5]) {
    const parsed = model.methods.visibility.arguments.safeParse({
      name: NAME,
      quality,
      repoVisibility: "private",
    });
    assertEquals(parsed.success, false, String(quality));
  }
});

Deno.test("visibility: records the quality once the registry gives its points", async () => {
  await withDraft(async (_dir, ctx) => {
    await model.methods.visibility.execute(
      args({ quality: 87, provisionalQuality: 100 }),
      ctx,
    );
    const data = ctx.store.get(`visibility-${NAME}`)!;
    assertEquals(data.quality, 87);
    assertEquals(data.provisionalQuality, 100);
    assertEquals(data.canBePublic, true, JSON.stringify(data.checks));
  });
});

Deno.test("visibility: the quality with the registry's points is a percentage, 0 when not given", () => {
  assertEquals(args().provisionalQuality, 0);
  for (const provisionalQuality of [-1, 101, 99.5]) {
    const parsed = model.methods.visibility.arguments.safeParse({
      name: NAME,
      quality: 87,
      provisionalQuality,
      repoVisibility: "private",
    });
    assertEquals(parsed.success, false, String(provisionalQuality));
  }
});
