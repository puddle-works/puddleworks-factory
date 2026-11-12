/**
 * Tests for the draft model's `round` method on a real git checkout: what
 * must be fixed before a review round, the limit of two per build, round 2's
 * diff, and a change that only bumps the version.
 *
 * swamp is faked: the push dry run and `extension quality` report a content
 * hash of what ships (manifest, README, workflows and models, not tests), as
 * the real CLI does.
 *
 * Run with:
 *   $(swamp doctor extensions --json | jq -r .denoPath) test -A extensions/models/draft_round_test.ts
 *
 * @module
 */
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";
import { REVIEW_DIMENSIONS } from "../lib/readiness.ts";
import { gitCheckout } from "../lib/target_testing.ts";
import { passingTests } from "../lib/evidence_testing.ts";
import type { SwampRun } from "../lib/recipe_check.ts";
import type { ReviewRound } from "../lib/rounds.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);
const REPO = "https://github.com/example/obsidian-puddle-scanner";
const NAME = "obsidian-puddle-scanner";
const PKG = `@puddleworks/${NAME}`;

/** SHA-256 over what ships: manifest, README, workflows and models. */
async function shipped(dir: string): Promise<string> {
  const parts: string[] = [];
  const walk = async (rel: string) => {
    for await (const e of Deno.readDir(`${dir}/${rel}`)) {
      const path = `${rel}/${e.name}`;
      if (e.isDirectory) await walk(path);
      else if (!e.name.endsWith("_test.ts")) {
        parts.push(`${path}\0${await Deno.readTextFile(`${dir}/${path}`)}`);
      }
    }
  };
  for (const d of ["extensions", "workflows"]) {
    await walk(d).catch(() => {});
  }
  for (const f of ["manifest.yaml", "README.md"]) {
    parts.push(`${f}\0${await Deno.readTextFile(`${dir}/${f}`)}`);
  }
  const bytes = new TextEncoder().encode(parts.sort().join("\0"));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the fake swamp's dry run adds; set per test. */
interface Registry {
  warnings?: Record<string, unknown[]>;
  published?: string[];
  /** The push fails before it hashes anything, saying this on stderr. */
  broken?: string;
}

function fakeSwamp(registry: Registry): SwampRun {
  return async (args, dir) => {
    const hash = await shipped(dir!);
    if (args[1] === "quality") {
      return {
        code: 0,
        stdout: JSON.stringify({
          cacheHash: hash,
          grade: "B",
          earnedPoints: 14,
          maxClientEarnablePoints: 14,
          gateFailures: [],
          factors: [],
        }),
        stderr: "",
      };
    }
    if (args[1] === "push" && registry.broken) {
      return {
        code: 1,
        stdout: JSON.stringify({ status: "failed" }),
        stderr: registry.broken,
      };
    }
    if (args[1] === "push") {
      const manifest = await Deno.readTextFile(`${dir}/manifest.yaml`);
      const version = manifest.match(/^version: "(.+)"$/m)![1];
      const taken = registry.published?.includes(version);
      return {
        code: taken ? 1 : 0,
        stdout: JSON.stringify({
          contentHash: hash,
          registryChecks: taken
            ? [{
              name: "version-exists",
              status: "failed",
              message: `Version ${version} already exists for ${PKG}.`,
            }]
            : [],
          warnings: {
            review: [{
              ruleId: "adversarial-review-report",
              skeleton: { extension: PKG, version },
            }],
            ...registry.warnings,
          },
        }),
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: `not faked: ${args}` };
  };
}

function makeContext(registry: Registry) {
  const store = new Map<string, Record<string, unknown>>();
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { debug: () => {}, info: () => {}, warning: () => {} },
    writeResource(_spec: string, name: string, data: Record<string, unknown>) {
      store.set(name, structuredClone(data));
      return Promise.resolve({ name });
    },
    readResource(name: string) {
      return Promise.resolve(structuredClone(store.get(name) ?? null));
    },
    runSwamp: fakeSwamp(registry),
    runTests: passingTests,
    store,
  };
}

type Ctx = ReturnType<typeof makeContext>;

/**
 * A behavior at `version`, with a no-op upgrade to each of `upgrades`. The
 * export is spelt in pieces, so swamp doesn't index this test as a model.
 */
const behavior = (version: string, upgrades: string[], body = "") =>
  `${"export"} const model = {
  type: "${PKG}/app",
  version: "${version}",
  upgrades: [${
    upgrades.map((v) => `
    {
      toVersion: "${v}",
      description: "No data migration required.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },`).join("")
  }
  ],
  methods: {${body}},
};
`;

/** A rendered draft in a real git checkout, committed. */
async function withDraft(
  fn: (
    w: { dir: string; commit: (m?: string) => Promise<string> },
    ctx: Ctx,
    registry: Registry,
  ) => Promise<void>,
) {
  const w = await gitCheckout(REPO, "factory-round-");
  const registry: Registry = {};
  const ctx = makeContext(registry);
  try {
    await model.methods.render.execute(
      model.methods.render.arguments.parse({
        spec: EXAMPLE_TEXT,
        targetDir: w.dir,
        repository: REPO,
      }),
      ctx,
    );
    await Deno.writeTextFile(
      `${w.dir}/extensions/models/app.ts`,
      behavior(await versionOf(w.dir), [await versionOf(w.dir)]),
    );
    await w.commit("draft");
    await fn(w, ctx, registry);
  } finally {
    await Deno.remove(w.dir, { recursive: true });
  }
}

const versionOf = async (dir: string) =>
  (await Deno.readTextFile(`${dir}/manifest.yaml`)).match(
    /^version: "(.+)"$/m,
  )![1];

const round = (ctx: Ctx, over: Record<string, unknown> = {}) =>
  model.methods.round.execute(
    model.methods.round.arguments.parse({ name: NAME, ...over }),
    ctx,
  );

const record = (ctx: Ctx) =>
  ctx.store.get(`review-rounds-${NAME}`) as {
    rounds: ReviewRound[];
    latest: ReviewRound & { skeleton: unknown; previous: unknown };
  };

/** The reviewer's report for the latest round, every dimension passed. */
async function review(dir: string, ctx: Ctx) {
  const { latest } = record(ctx);
  await Deno.mkdir(`${dir}/swamp-extension-review`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/${latest.file}`,
    JSON.stringify({
      extension: PKG,
      version: latest.version,
      reviewedAt: "2026-11-11T12:00:00Z",
      dimensions: REVIEW_DIMENSIONS.map((id) => ({ id, verdict: "pass" })),
    }),
  );
}

/** A change to what ships. */
async function fix(dir: string, n: number) {
  const readme = `${dir}/README.md`;
  await Deno.writeTextFile(
    readme,
    `${await Deno.readTextFile(readme)}\nFix ${n}.\n`,
  );
}

Deno.test("round: a change that isn't committed is refused, the reviewer's own files aren't", async () => {
  await withDraft(async ({ dir }, ctx) => {
    await fix(dir, 1);
    await assertRejects(() => round(ctx), Error, "README.md");
    await Deno.writeTextFile(`${dir}/README.md`, "");
    await assertRejects(() => round(ctx), Error, "Commit these");
    assertEquals(record(ctx), undefined);
  });
});

Deno.test("round: every other dry-run warning, and a published version, is fixed before round 1", async () => {
  await withDraft(async (w, ctx, registry) => {
    registry.warnings = {
      safety: [{
        ruleId: "deno-command",
        message: "Line 4 uses Deno.Command()",
      }],
    };
    await assertRejects(() => round(ctx), Error, "[deno-command]");
    assertEquals(record(ctx), undefined);

    // An app accepts a warning on purpose in ci.yml, as publish.sh does.
    const ci = `${w.dir}/.github/workflows/ci.yml`;
    await Deno.writeTextFile(
      ci,
      (await Deno.readTextFile(ci)).replace(
        /^(\s*)dry-run:.*$/m,
        "$&\n$1accepted-warnings: deno-command",
      ),
    );
    await w.commit("accept");
    registry.published = [await versionOf(w.dir)];
    await assertRejects(() => round(ctx), Error, "already exists");
    registry.published = [];
    await round(ctx);
    assertEquals(record(ctx).latest.round, 1);
  });
});

Deno.test("round: two rounds, then each one more needs the user's yes", async () => {
  await withDraft(async (w, ctx) => {
    await round(ctx);
    const one = record(ctx).latest;
    assertEquals([one.kind, one.round, one.base, one.granted], [
      "review",
      1,
      null,
      false,
    ]);
    assertEquals(one.skeleton, { extension: PKG, version: one.version });
    await review(w.dir, ctx);

    await fix(w.dir, 1);
    const fixed = await w.commit("fix 1");
    await round(ctx);
    const two = record(ctx).latest;
    assertEquals([two.round, two.base, two.commit], [2, one.commit, fixed]);
    assertEquals(two.changed, ["README.md"]);
    // Round 2 starts from round 1's verdicts.
    assertEquals(
      (two.previous as { dimensions: unknown[] }).dimensions.length,
      REVIEW_DIMENSIONS.length,
    );
    await review(w.dir, ctx);

    await fix(w.dir, 2);
    await w.commit("fix 2");
    await assertRejects(() => round(ctx), Error, "Round 3 would pass");
    assertEquals(record(ctx).rounds.length, 2);
    await round(ctx, { grant: true });
    assertEquals([record(ctx).latest.round, record(ctx).latest.granted], [
      3,
      true,
    ]);

    await fix(w.dir, 3);
    await w.commit("fix 3");
    await assertRejects(() => round(ctx), Error, "Round 4 would pass");
  });
});

Deno.test("round: the same content again is the same round", async () => {
  await withDraft(async (w, ctx) => {
    await round(ctx);
    // A change that doesn't ship (a test) keeps the content hash.
    await Deno.writeTextFile(`${w.dir}/extensions/models/x_test.ts`, "");
    await w.commit("test");
    await round(ctx);
    assertEquals(record(ctx).rounds.length, 1);
    assertEquals(record(ctx).latest.round, 1);
  });
});

Deno.test("round: freezes what ships after round 2, as readiness says", async () => {
  await withDraft(async (w, ctx) => {
    await model.methods.visibility.execute(
      model.methods.visibility.arguments.parse({
        name: NAME,
        quality: 100,
        repoVisibility: "private",
      }),
      ctx,
    );
    for (const n of [1, 2]) {
      await fix(w.dir, n);
      await w.commit(`fix ${n}`);
      await round(ctx);
      await review(w.dir, ctx);
    }
    const ready = async () => {
      await model.methods.readiness.execute(
        model.methods.readiness.arguments.parse({
          name: NAME,
          review: record(ctx).latest.file,
        }),
        ctx,
      );
      return ctx.store.get(`readiness-${NAME}`)!;
    };
    const ok = await ready();
    assertEquals(ok.ready, true, String(ok.summary));
    assertStringIncludes(String(ok.summary), "round 2 of 2");

    await fix(w.dir, 3);
    const late = await ready();
    assertEquals(late.ready, false);
    assertStringIncludes(
      (late.blockers as string[]).join("\n"),
      "after round 2, which froze it",
    );
  });
});

/** Write the build result, as the skill does at each step that has one. */
const result = (ctx: Ctx, over: Record<string, unknown> = {}) =>
  model.methods.result.execute(
    model.methods.result.arguments.parse({
      name: NAME,
      buildRef: `draft/${NAME}`,
      ...over,
    }),
    ctx,
  );

/** Publish the reviewed version: commit the report, and record it. */
async function publish(
  w: { dir: string; commit: (m?: string) => Promise<string> },
  ctx: Ctx,
  registry: Registry,
) {
  await review(w.dir, ctx);
  const buildRef = await w.commit("Review for publishing");
  const version = await versionOf(w.dir);
  registry.published = [...(registry.published ?? []), version];
  await result(ctx, {
    buildRef,
    publishedVersion: version,
    publishedVisibility: "private",
  });
}

/** Bump the manifest and the behavior to `next`, with a no-op upgrade. */
async function bump(dir: string, next: string, body = "") {
  const old = await versionOf(dir);
  const manifest = `${dir}/manifest.yaml`;
  await Deno.writeTextFile(
    manifest,
    (await Deno.readTextFile(manifest)).replace(
      `version: "${old}"`,
      `version: "${next}"`,
    ),
  );
  await Deno.writeTextFile(
    `${dir}/extensions/models/app.ts`,
    behavior(next, [old, next], body),
  );
}

Deno.test("round: a change that only bumps the version carries the review over", async () => {
  await withDraft(async (w, ctx, registry) => {
    await round(ctx);
    await publish(w, ctx, registry);
    const reviewed = record(ctx).latest;

    await Deno.writeTextFile(
      `${w.dir}/.github/workflows/extra.yml`,
      "on: {}\n",
    );
    await bump(w.dir, "2099.1.1.1");
    await w.commit("Release 2099.1.1.1");
    await round(ctx);
    const carried = record(ctx).latest;
    assertEquals(carried.kind, "carried");
    assertEquals(carried.round, 0);
    assertEquals(carried.carriedFrom, {
      version: reviewed.version,
      contentHash: reviewed.contentHash,
    });
    assertEquals(record(ctx).rounds.length, 2);
    const report = JSON.parse(
      await Deno.readTextFile(`${w.dir}/${carried.file}`),
    );
    assertEquals(report.version, "2099.1.1.1");
    assertEquals(report.extension, PKG);
    assertEquals(report.dimensions.length, REVIEW_DIMENSIONS.length);
  });
});

Deno.test("round: a bump with any other change that ships is a new build's round 1", async () => {
  await withDraft(async (w, ctx, registry) => {
    await round(ctx);
    await fix(w.dir, 1);
    await w.commit("fix 1");
    await round(ctx);
    await publish(w, ctx, registry);

    await bump(w.dir, "2099.1.1.1", "\n    run: {},\n  ");
    await w.commit("Release with a change");
    await round(ctx);
    const next = record(ctx).latest;
    assertEquals([next.kind, next.round, next.base], ["review", 1, null]);
    assertEquals(
      await Deno.stat(`${w.dir}/${next.file}`).then(() => true, () => false),
      false,
    );
  });
});

Deno.test("round: a report already committed for this content needs no round", async () => {
  await withDraft(async (w, ctx) => {
    await round(ctx);
    await review(w.dir, ctx);
    await w.commit("Review for publishing");
    // A new instance's record, as on another desk: nothing recorded yet.
    ctx.store.delete(`review-rounds-${NAME}`);
    await round(ctx);
    assertEquals([record(ctx).latest.kind, record(ctx).latest.round], [
      "committed",
      0,
    ]);
  });
});

Deno.test("round: a build result written before publishing keeps where the last build ended", async () => {
  await withDraft(async (w, ctx, registry) => {
    await round(ctx);
    await fix(w.dir, 1);
    await w.commit("fix 1");
    await round(ctx);
    await publish(w, ctx, registry);
    const published = await versionOf(w.dir);

    // The next build: its first result has nothing published yet, and so
    // has the one written when the user stops before publishing.
    await bump(w.dir, "2099.1.1.1", "\n    run: {},\n  ");
    await w.commit("Release with a change");
    await result(ctx);
    assertEquals(
      (ctx.store.get(`build-result-${NAME}`) as { published?: unknown })
        .published,
      undefined,
    );
    await round(ctx);
    const one = record(ctx).latest;
    assertEquals([one.kind, one.round, one.base], ["review", 1, null]);
    await review(w.dir, ctx);

    // It has its own two rounds, and no more without a yes.
    await fix(w.dir, 2);
    await w.commit("fix 2");
    await result(ctx, { pullRequest: `${REPO}/pull/2` });
    await round(ctx);
    assertEquals(record(ctx).latest.round, 2);
    await fix(w.dir, 3);
    await w.commit("fix 3");
    await assertRejects(() => round(ctx), Error, "Round 3 would pass");
    assertEquals(
      (record(ctx) as unknown as { published: string }).published,
      published,
    );
  });
});

Deno.test("round: a publish dry run that fails says what swamp said", async () => {
  await withDraft(async (_w, ctx, registry) => {
    registry.broken =
      "Error: Model file not found: extensions/models/missing.ts\n";
    const e = await assertRejects(() => round(ctx), Error);
    assertStringIncludes(e.message, "swamp extension push exited 1");
    assertStringIncludes(e.message, "Model file not found");
    assertEquals(record(ctx), undefined);
  });
});
