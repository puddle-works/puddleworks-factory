/**
 * The whole build path on one model instance (#52): an approved spec is
 * rendered into a disposable app checkout, implemented, checked, reviewed and
 * recorded as published, and each step's record is read back as the next step
 * and a resumed run would read it. The blocked paths change no file and record
 * nothing ready.
 *
 * swamp is faked: `extension quality` reports a content hash taken from the
 * checkout's files, so a change after the review makes the review stale, as
 * it does with the real CLI. Stage order and human approvals are proved by the
 * saved scenarios in docs/stagecraft/factory-build.yaml.
 *
 * @module
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";
import { REVIEW_DIMENSIONS } from "../lib/readiness.ts";
import { appCheckout, gitCheckout, gitIn } from "../lib/target_testing.ts";
import { passingTests } from "../lib/evidence_testing.ts";
import type { SwampRun } from "../lib/recipe_check.ts";

const SPEC_PATH = new URL(
  "../../docs/contracts/app-spec.v1.example.json",
  import.meta.url,
).pathname;
const SPEC_TEXT = await Deno.readTextFile(SPEC_PATH);
// sha256sum docs/contracts/app-spec.v1.example.json, taken outside the code.
const SPEC_SHA256 =
  "c1b544cdd463bdbe74e6f93f1dfa88d67e39588ffb724c36e5082c2d1251cc8c";
const REPO = "https://github.com/example/obsidian-puddle-scanner";
const NAME = "obsidian-puddle-scanner";
const PKG = `@puddleworks/${NAME}`;
const COMMIT = "c5aaad329c9ceb4edc0504a98ff5d6e5528ac8fd";
const PR = `${REPO}/pull/1`;

/** Every file under dir, relative to it, with its text. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string, at: string) => {
    for await (const e of Deno.readDir(d)) {
      const rel = at ? `${at}/${e.name}` : e.name;
      if (e.isDirectory) await walk(`${d}/${e.name}`, rel);
      else out.set(rel, await Deno.readTextFile(`${d}/${e.name}`));
    }
  };
  await walk(dir, "");
  return out;
}

/** SHA-256 over what push would package: the extension, workflows, manifest. */
async function contentHash(dir: string): Promise<string> {
  const files = [...(await snapshot(dir))]
    .filter(([p]) =>
      /^(extensions|workflows)\//.test(p) || p === "manifest.yaml" ||
      p === "README.md"
    )
    .sort(([a], [b]) => a < b ? -1 : 1);
  const bytes = new TextEncoder().encode(
    files.map(([p, t]) => `${p}\0${t}\0`).join(""),
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `swamp extension quality`, scoring the checkout as it is now. */
function fakeSwamp(score: { earned: number; gateFailures: string[] }) {
  const run: SwampRun = async (args, dir) => {
    if (args[0] === "extension" && args[1] === "push") {
      // The dry run with no review recorded, as push names it.
      return {
        code: 0,
        stdout: JSON.stringify({
          contentHash: await contentHash(dir!),
          registryChecks: [],
          warnings: {
            review: [{
              ruleId: "adversarial-review-report",
              skeleton: { extension: PKG },
            }],
          },
        }),
        stderr: "",
      };
    }
    if (args[0] !== "extension" || args[1] !== "quality") {
      return { code: 1, stdout: "", stderr: `not faked: ${args}` };
    }
    return {
      code: 0,
      stdout: JSON.stringify({
        cacheHash: await contentHash(dir!),
        grade: score.earned === 14 ? "B" : "C",
        rubricVersion: 6,
        earnedPoints: score.earned,
        maxClientEarnablePoints: 14,
        gateFailures: score.gateFailures.map((message) => ({ message })),
        factors: score.earned === 14
          ? [{ id: "repository-verified", status: "provisional" }]
          : [{ id: "rich-readme", status: "missing" }],
      }),
      stderr: "",
    };
  };
  return run;
}

/**
 * A model context over a store that outlives it, as swamp's data does
 * between runs. `failWrites` makes the next writes fail, as an interrupted
 * run does after its files are in place.
 */
function contextOver(
  store: Map<string, Record<string, unknown>>,
  score = { earned: 14, gateFailures: [] as string[] },
) {
  const writes: string[] = [];
  const ctx = {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { debug: () => {}, info: () => {}, warning: () => {} },
    failWrites: 0,
    writeResource(_spec: string, name: string, data: Record<string, unknown>) {
      if (ctx.failWrites > 0) {
        ctx.failWrites--;
        return Promise.reject(new Error("swamp was interrupted"));
      }
      writes.push(name);
      store.set(name, structuredClone(data));
      return Promise.resolve({ name });
    },
    readResource(name: string) {
      return Promise.resolve(structuredClone(store.get(name) ?? null));
    },
    runSwamp: fakeSwamp(score),
    runTests: passingTests,
    writes,
  };
  return ctx;
}

type Ctx = ReturnType<typeof contextOver>;

const run = <M extends keyof typeof model.methods>(
  m: M,
  args: Record<string, unknown>,
  ctx: Ctx,
) =>
  // deno-lint-ignore no-explicit-any
  (model.methods[m] as any).execute(
    // deno-lint-ignore no-explicit-any
    (model.methods[m] as any).arguments.parse(args),
    ctx,
  );

/**
 * Commit the checkout, start a review round, and write the independent
 * review's report where the round says, named for the content now.
 */
async function writeReview(
  dir: string,
  store: Map<string, Record<string, unknown>>,
): Promise<string> {
  const manifest = await Deno.readTextFile(`${dir}/manifest.yaml`);
  const version = manifest.match(/^version: "(.+)"$/m)![1];
  await gitIn(dir, "add", "-A");
  await gitIn(dir, "commit", "-q", "--allow-empty", "-m", "build");
  await run("round", { name: NAME }, contextOver(store));
  const latest = store.get(`review-rounds-${NAME}`)!.latest as {
    file: string;
  };
  const path = latest.file;
  assertEquals(
    path,
    `swamp-extension-review/${
      PKG.replaceAll("@", "_").replaceAll("/", "_")
    }-${await contentHash(dir)}.json`,
  );
  await Deno.mkdir(`${dir}/swamp-extension-review`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/${path}`,
    JSON.stringify({
      extension: PKG,
      version,
      reviewedAt: "2026-11-10T12:00:00Z",
      dimensions: REVIEW_DIMENSIONS.map((id) => ({ id, verdict: "pass" })),
    }),
  );
  return path;
}

/** Fill in the drafted behaviour test-first, as implement does. */
async function implement(dir: string, test: string) {
  const models = `${dir}/extensions/models`;
  const file =
    [...Deno.readDirSync(models)].find((e) => e.name.endsWith("_test.ts"))!
      .name;
  await Deno.writeTextFile(
    `${models}/${file}`,
    `${await Deno.readTextFile(`${models}/${file}`)}\n` +
      `Deno.test(${JSON.stringify(test)}, () => {});\n`,
  );
}

/** Map the acceptance criterion in spec/ to the given test. */
async function acceptance(dir: string, tests: string[]) {
  await Deno.mkdir(`${dir}/spec`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/spec/outcome-spec.v1.json`,
    JSON.stringify({
      specification: {
        version: 1,
        acceptanceCriteria: [{ id: "AC1", text: "Lists open tasks" }],
      },
    }),
  );
  await Deno.writeTextFile(
    `${dir}/spec/acceptance.json`,
    JSON.stringify({ criteria: [{ id: "AC1", tests }] }),
  );
}

/** readiness said not ready, for these reasons only, one blocker each. */
function blockedBy(
  store: Map<string, Record<string, unknown>>,
  ...says: string[]
) {
  const data = store.get(`readiness-${NAME}`)!;
  assertEquals(data.ready, false);
  const blockers = data.blockers as string[];
  assertEquals(blockers.length, says.length, blockers.join("\n"));
  says.forEach((s, i) => assertStringIncludes(blockers[i], s));
}

const readiness = (review: string, ctx: Ctx) =>
  run("readiness", {
    name: NAME,
    review,
    pullRequest: PR,
    commit: COMMIT,
  }, ctx).then(() => ctx.writes.at(-1));

/** A rendered, implemented and visibility-checked draft, ready for review. */
async function built(
  fn: (
    dir: string,
    store: Map<string, Record<string, unknown>>,
  ) => Promise<void>,
) {
  const { dir } = await gitCheckout(REPO, "factory-e2e-", `draft/${NAME}`);
  const store = new Map<string, Record<string, unknown>>();
  try {
    const ctx = contextOver(store);
    await run("render", {
      spec: SPEC_PATH,
      specDigest: SPEC_SHA256,
      targetDir: dir,
      repository: REPO,
      branch: `draft/${NAME}`,
    }, ctx);
    await implement(dir, "lists open tasks");
    await acceptance(dir, ["lists open tasks"]);
    await run("visibility", {
      name: NAME,
      quality: 100,
      repoVisibility: "private",
    }, ctx);
    await fn(dir, store);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("end to end: an approved spec goes to a recorded publish, each step's record read back", async () => {
  await built(async (dir, store) => {
    const draft = store.get(NAME)!;
    assertEquals(draft.targetDir, dir);
    assertEquals(draft.repository, REPO);

    // A later run, in a new process, reads what the earlier ones recorded.
    const resumed = contextOver(store);
    const review = await writeReview(dir, store);
    assertEquals(await readiness(review, resumed), `readiness-${NAME}`);
    const ready = store.get(`readiness-${NAME}`)!;
    assertEquals(ready.ready, true, String(ready.summary));
    assertEquals(ready.package, PKG);
    assertEquals(ready.commit, COMMIT);
    assertEquals(ready.pullRequest, PR);
    assertEquals(ready.reviewFile, `${dir}/${review}`);
    assertStringIncludes(String(ready.summary), "AC1");

    const out = `${await Deno.makeTempDir()}/result.json`;
    await run("result", {
      name: NAME,
      buildRef: COMMIT,
      pullRequest: PR,
      publishedVersion: "2026.11.10.1",
      publishedVisibility: "private",
      out,
    }, resumed);
    const result = JSON.parse(await Deno.readTextFile(out));
    assertEquals(result.repository, REPO);
    assertEquals(result.buildRef, COMMIT);
    assertEquals(result.pullRequest, PR);
    assertStringIncludes(JSON.stringify(result.published), "2026.11.10.1");
    await Deno.remove(out.slice(0, out.lastIndexOf("/")), { recursive: true });
  });
});

Deno.test("end to end: a change after the review makes it stale", async () => {
  await built(async (dir, store) => {
    const review = await writeReview(dir, store);
    await implement(dir, "a late change");
    await acceptance(dir, ["lists open tasks"]);
    await readiness(review, contextOver(store));
    blockedBy(
      store,
      "the code changed after the review",
      "No review round is recorded for this content",
    );
  });
});

Deno.test("end to end: a failed or missing quality factor blocks", async () => {
  await built(async (dir, store) => {
    const review = await writeReview(dir, store);
    await readiness(
      review,
      contextOver(store, { earned: 13, gateFailures: [] }),
    );
    blockedBy(store, "13/14 client points");
    await readiness(
      review,
      contextOver(store, { earned: 14, gateFailures: ["fmt-lint failed"] }),
    );
    blockedBy(store, "fmt-lint failed");
  });
});

Deno.test("end to end: an acceptance criterion with no test, or a failing one, blocks", async () => {
  await built(async (dir, store) => {
    await acceptance(dir, ["a test nobody wrote"]);
    const review = await writeReview(dir, store);
    await readiness(review, contextOver(store));
    blockedBy(store, "not in any *_test.ts");
    await acceptance(dir, []);
    await readiness(review, contextOver(store));
    blockedBy(store, "AC1 has no test");

    await acceptance(dir, ["lists open tasks"]);
    const failing = contextOver(store);
    failing.runTests = async (d) => {
      const { tests } = await passingTests(d);
      return {
        tests: (tests ?? []).map((t) => ({
          ...t,
          passed: t.name !== "lists open tasks",
        })),
      };
    };
    await readiness(review, failing);
    blockedBy(store, "1 test failed", 'AC1\'s test "lists open tasks" failed');
  });
});

Deno.test("end to end: a missing review report blocks", async () => {
  await built(async (_dir, store) => {
    await readiness("swamp-extension-review/none.json", contextOver(store));
    blockedBy(
      store,
      "could not be read",
      "No review round is recorded for this content",
    );
  });
});

Deno.test("end to end: the Factory's checkout, another repo and a changed spec write nothing", async () => {
  const factory = await Deno.realPath(new URL("../..", import.meta.url));
  const other = await appCheckout("https://github.com/example/other-app");
  const app = await appCheckout(REPO);
  const specDir = await Deno.makeTempDir();
  try {
    const store = new Map<string, Record<string, unknown>>();
    const before = await Promise.all([factory, other, app].map(snapshot));
    const ctx = contextOver(store);
    const refusals = [[factory, "Factory's own checkout"], [
      other,
      "other-app",
    ]];
    for (const [targetDir, says] of refusals) {
      await assertRejects(
        () =>
          run("render", { spec: SPEC_TEXT, targetDir, repository: REPO }, ctx),
        Error,
        says,
      );
    }
    await Deno.writeTextFile(`${specDir}/spec.json`, `${SPEC_TEXT}\n`);
    await assertRejects(
      () =>
        run("render", {
          spec: `${specDir}/spec.json`,
          specDigest: SPEC_SHA256,
          targetDir: app,
          repository: REPO,
        }, ctx),
      Error,
      "changed since it was approved",
    );
    assertEquals(ctx.writes, []);
    assertEquals(
      await Promise.all([factory, other, app].map(snapshot)),
      before,
    );
  } finally {
    await Deno.remove(other, { recursive: true });
    await Deno.remove(app, { recursive: true });
    await Deno.remove(specDir, { recursive: true });
  }
});

Deno.test("end to end: a render interrupted before its record resumes with overwrite", async () => {
  const dir = await appCheckout(REPO);
  try {
    const store = new Map<string, Record<string, unknown>>();
    const ctx = contextOver(store);
    ctx.failWrites = 1;
    const args = { spec: SPEC_TEXT, targetDir: dir, repository: REPO };
    await assertRejects(() => run("render", args, ctx), Error, "interrupted");
    assert((await snapshot(dir)).has("manifest.yaml"));
    assertEquals(store.has(NAME), false);
    // Nothing recorded, so later steps refuse rather than read a half run.
    await assertRejects(() =>
      run("readiness", { name: NAME, review: "x" }, ctx)
    );

    await assertRejects(
      () => run("render", args, ctx),
      Error,
      "Refusing to overwrite",
    );
    await run("render", { ...args, overwrite: true }, ctx);
    assertEquals(store.get(NAME)!.targetDir, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
