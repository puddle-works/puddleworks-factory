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
import { appCheckout } from "../lib/target_testing.ts";

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
  const dir = await appCheckout(REPO, "factory-revise-");
  try {
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

// The app repo may be public one day (#145). specHash covers only the
// specification, so the copy still matches the agreed version.
Deno.test("revise: keeps v2 in spec/ without anyone's email, names and hash as agreed", async () => {
  await withApp(async (dir, ctx) => {
    const outcome = v2((n) => {
      const next = n as typeof OUTCOME;
      next.agreement.agreedBy.email = "priya.shah@acme-stores.co.uk";
      next.participants[1].email = "tom.reyes@acme-stores.co.uk";
    });
    await run(ctx, { outcomeSpec: outcome });
    const text = await Deno.readTextFile(`${dir}/spec/outcome-spec.v2.json`);
    assertEquals(text.includes("@"), false, text);
    const saved = JSON.parse(text);
    assertEquals(saved.agreement.agreedBy, { name: "Priya Shah", email: "" });
    assertEquals(
      saved.participants.map((p: { name: string }) => p.name),
      ["Priya Shah", "Tom Reyes"],
    );
    assertEquals(saved.agreement.specHash, "f".repeat(64));
    assertEquals(
      saved.specification.changeSummary,
      JSON.parse(outcome).specification.changeSummary,
    );
    // The copy is read back as v2: the same version again is refused.
    await assertRejects(
      () => run(ctx, { outcomeSpec: outcome }),
      Error,
      "already meets version 2",
    );
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

Deno.test("revise: refuses a spec/ that is a symlink, and writes nothing through it", async () => {
  await withApp(async (dir, ctx) => {
    const outside = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "outside-" }),
    );
    try {
      for (const e of Deno.readDirSync(`${dir}/spec`)) {
        await Deno.copyFile(`${dir}/spec/${e.name}`, `${outside}/${e.name}`);
      }
      await Deno.remove(`${dir}/spec`, { recursive: true });
      await Deno.symlink(outside, `${dir}/spec`);
      const before = [...Deno.readDirSync(outside)].map((e) => e.name).sort();
      await assertRejects(
        () => run(ctx, { outcomeSpec: v2() }),
        Error,
        "spec in the checkout is a symlink",
      );
      assertEquals(
        [...Deno.readDirSync(outside)].map((e) => e.name).sort(),
        before,
      );
      const draft = ctx.store.get(NAME) as { source?: { version: number } };
      assertEquals(draft.source?.version === 2, false);
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("revise: a run stopped before its record can be run again to finish", async () => {
  await withApp(async (dir, ctx) => {
    // Recorded at v1, as a draft built from the request would be.
    const built = ctx.store.get(NAME)!;
    ctx.store.set(NAME, {
      ...built,
      source: {
        url: OUTCOME.request.url,
        version: 1,
        specHash: OUTCOME.agreement.specHash,
      },
    });
    const write = ctx.writeResource;
    ctx.writeResource = () => Promise.reject(new Error("store went away"));
    await assertRejects(
      () => run(ctx, { outcomeSpec: v2() }),
      Error,
      "store went away",
    );
    assertEquals(
      (ctx.store.get(NAME) as { source: { version: number } }).source.version,
      1,
    );
    ctx.writeResource = write;
    await run(ctx, { outcomeSpec: v2() });
    const draft = ctx.store.get(NAME) as { source: { version: number } };
    assertEquals(draft.source.version, 2);
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/spec/change-plan.v2.md`),
      "- scope.in, added: Sending orders to suppliers",
    );
    // Once recorded, the same version is refused again.
    await assertRejects(
      () => run(ctx, { outcomeSpec: v2() }),
      Error,
      "already meets version 2",
    );
  });
});

Deno.test("revise: names spec/app-spec.json when it isn't JSON, and writes nothing", async () => {
  await withApp(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/spec/app-spec.json`, "{ not json");
    await assertRejects(
      () => run(ctx, { outcomeSpec: v2() }),
      Error,
      "spec/app-spec.json is not valid JSON",
    );
    assertEquals(
      [...Deno.readDirSync(`${dir}/spec`)].map((e) => e.name).sort(),
      ["app-spec.json", "outcome-spec.v1.json"],
    );
  });
});

Deno.test("revise: a draft rendered without a source can finish a stopped run too", async () => {
  await withApp(async (dir, ctx) => {
    assertEquals(
      (ctx.store.get(NAME) as { source?: unknown }).source,
      undefined,
    );
    const write = ctx.writeResource;
    ctx.writeResource = () => Promise.reject(new Error("store went away"));
    await assertRejects(
      () => run(ctx, { outcomeSpec: v2() }),
      Error,
      "store went away",
    );
    ctx.writeResource = write;
    await run(ctx, { outcomeSpec: v2() });
    const draft = ctx.store.get(NAME) as { source: { version: number } };
    assertEquals(draft.source.version, 2);
    await assertRejects(
      () => run(ctx, { outcomeSpec: v2() }),
      Error,
      "already meets version 2",
    );
    assertStringIncludes(
      await Deno.readTextFile(`${dir}/spec/change-plan.v2.md`),
      "- scope.in, added: Sending orders to suppliers",
    );
  });
});

Deno.test("revise: an outcome spec at its version with no change plan is still refused", async () => {
  await withApp(async (_dir, ctx) => {
    // spec/ holds v1 from the build, not from a revise, and nothing records it.
    await assertRejects(
      () => run(ctx, { outcomeSpec: JSON.stringify(OUTCOME) }),
      Error,
      "already meets version 1",
    );
    assertEquals(
      (ctx.store.get(NAME) as { source?: unknown }).source,
      undefined,
    );
  });
});

Deno.test("revise: names spec/app-spec.json when it isn't an object, and writes nothing", async () => {
  await withApp(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/spec/app-spec.json`, "null");
    await assertRejects(
      () => run(ctx, { outcomeSpec: v2() }),
      Error,
      "spec/app-spec.json is not a JSON object",
    );
    assertEquals(
      [...Deno.readDirSync(`${dir}/spec`)].map((e) => e.name).sort(),
      ["app-spec.json", "outcome-spec.v1.json"],
    );
  });
});

Deno.test("revise: refuses an app spec that isn't valid once revised, and writes nothing", async () => {
  await withApp(async (dir, ctx) => {
    await Deno.writeTextFile(
      `${dir}/spec/app-spec.json`,
      JSON.stringify({ name: NAME }),
    );
    await assertRejects(
      () => run(ctx, { outcomeSpec: v2() }),
      Error,
      "is not a valid app spec, so nothing was written",
    );
    assertEquals(
      [...Deno.readDirSync(`${dir}/spec`)].map((e) => e.name).sort(),
      ["app-spec.json", "outcome-spec.v1.json"],
    );
    assertEquals(
      (ctx.store.get(NAME) as { source?: unknown }).source,
      undefined,
    );
  });
});
