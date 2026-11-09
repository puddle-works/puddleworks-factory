/**
 * Tests for the draft model's `planReview` method: record a review of the
 * build plan against the spec, tied to the version of the plan it was of.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/models/draft_plan_review_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";
import { appCheckout } from "../lib/target_testing.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);

const REPO = "https://github.com/example/obsidian-puddle-scanner";
const NAME = "obsidian-puddle-scanner";
// sha256 of "abc", from FIPS 180-2.
const ABC =
  "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function makeContext() {
  const store = new Map<string, Record<string, unknown>>();
  const writes: Array<{ specName: string; name: string; data: unknown }> = [];
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { debug: () => {}, info: () => {}, warning: () => {} },
    writeResource(
      specName: string,
      name: string,
      data: Record<string, unknown>,
    ) {
      writes.push({ specName, name, data });
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
  render = true,
) {
  const dir = await appCheckout(REPO, "factory-plan-review-");
  try {
    const ctx = makeContext();
    if (render) {
      await model.methods.render.execute(
        model.methods.render.arguments.parse({
          spec: EXAMPLE_TEXT,
          targetDir: dir,
          repository: REPO,
        }),
        ctx,
      );
    }
    await fn(dir, ctx);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const run = (
  ctx: ReturnType<typeof makeContext>,
  args: Record<string, unknown>,
) =>
  model.methods.planReview.execute(
    model.methods.planReview.arguments.parse({ name: NAME, ...args }),
    ctx,
  );

const reviews = (ctx: ReturnType<typeof makeContext>) =>
  ctx.writes.filter((w) => w.specName === "planReview").map((w) =>
    w.data as Record<string, unknown>
  );

Deno.test("planReview: records the verdict, the reply and the plan's hash", async () => {
  await withDraft(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/plan.md`, "abc");
    await Deno.writeTextFile(`${dir}/reply.txt`, "Meets AC1 and AC2.\n");
    await run(ctx, {
      plan: `${dir}/plan.md`,
      verdict: "pass",
      response: `${dir}/reply.txt`,
    });
    const [review] = reviews(ctx);
    assertEquals(ctx.writes.at(-1)!.name, `plan-review-${NAME}`);
    assertEquals(review.planHash, ABC);
    assertEquals(review.verdict, "pass");
    assertEquals(review.response, "Meets AC1 and AC2.");
    assertEquals(review.plan, `${dir}/plan.md`);
  });
});

Deno.test("planReview: a new plan gets its own review, with another hash", async () => {
  await withDraft(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/reply.txt`, "Misses AC2.");
    await Deno.writeTextFile(`${dir}/plan.md`, "abc");
    await run(ctx, {
      plan: `${dir}/plan.md`,
      verdict: "concerns",
      response: `${dir}/reply.txt`,
    });
    await Deno.writeTextFile(`${dir}/plan.md`, "abc\nand a test for AC2");
    await run(ctx, { plan: `${dir}/plan.md`, verdict: "pending" });
    const [first, second] = reviews(ctx);
    assertEquals(first.planHash, ABC);
    assertEquals(first.verdict, "concerns");
    assertNotEquals(second.planHash, ABC);
    assertEquals(second.verdict, "pending");
  });
});

Deno.test("planReview: a reviewer that failed is recorded, with no reply needed", async () => {
  await withDraft(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/plan.md`, "abc");
    await run(ctx, { plan: `${dir}/plan.md`, verdict: "failed" });
    assertEquals(reviews(ctx)[0].verdict, "failed");
    assertEquals(reviews(ctx)[0].response, "");
  });
});

Deno.test("planReview: pass or concerns needs the reviewer's reply", async () => {
  await withDraft(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/plan.md`, "abc");
    for (const verdict of ["pass", "concerns"]) {
      await assertRejects(
        () => run(ctx, { plan: `${dir}/plan.md`, verdict }),
        Error,
        "pass response",
      );
    }
    assertEquals(reviews(ctx), []);
  });
});

Deno.test("planReview: refuses a missing plan, and an app with no draft", async () => {
  await withDraft(async (dir, ctx) => {
    await assertRejects(
      () => run(ctx, { plan: `${dir}/none.md`, verdict: "pending" }),
      Error,
      "Could not read the plan",
    );
  });
  await withDraft(async (dir, ctx) => {
    await Deno.writeTextFile(`${dir}/plan.md`, "abc");
    await assertRejects(
      () => run(ctx, { plan: `${dir}/plan.md`, verdict: "pending" }),
      Error,
      "No draft",
    );
  }, false);
});
