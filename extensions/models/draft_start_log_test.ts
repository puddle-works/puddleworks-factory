/**
 * From the output alone you must be able to tell a slow run from a hung one:
 * each method says it has started before it touches the disk or the network,
 * and logs at debug before the slow steps, without keeping a spec or a secret.
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { stub } from "jsr:@std/testing@1.0.21/mock";
import { guarded, model } from "./draft.ts";
import { appCheckout } from "../lib/target_testing.ts";

const APP_SPEC = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);
const OUTCOME_SPEC = await Deno.readTextFile(
  new URL("../../docs/contracts/outcome-spec.v1.example.json", import.meta.url),
);
const NAME = JSON.parse(APP_SPEC).name as string;
const REPO = `https://github.com/example/${NAME}`;
const SECRET = "admin:hunter2@db.acme.io";

const DENO_IO = [
  "stat",
  "readDir",
  "readFile",
  "readTextFile",
  "writeTextFile",
  "mkdir",
  "rename",
];

/** Run fn with every Deno call the methods make recorded in events. */
async function recordingIo(events: string[], fn: () => Promise<unknown>) {
  const target = Deno as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const stubs = DENO_IO.map((name) => {
    const real = target[name];
    return stub(target, name, (...args: unknown[]) => {
      events.push(`io ${name}`);
      return real.apply(Deno, args);
    });
  });
  try {
    await fn();
  } catch {
    // What matters here is what was logged before any failure.
  } finally {
    for (const s of stubs) s.restore();
  }
}

/** A context that keeps resources, and records logs and reads in events. */
function context(events: string[], store: Map<string, unknown>) {
  const log = (level: string) => (msg: string, props?: unknown) => {
    events.push(`${level} ${msg} ${JSON.stringify(props ?? {})}`);
  };
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: {
      debug: log("debug"),
      info: log("info"),
      warning: log("warning"),
    },
    writeResource(_spec: string, name: string, data: Record<string, unknown>) {
      store.set(name, data);
      return Promise.resolve({ name });
    },
    readResource(name: string) {
      events.push("io readResource");
      return Promise.resolve(
        (store.get(name) as Record<string, unknown>) ?? null,
      );
    },
  };
}

/** A checkout with a rendered draft and both specs on disk. */
async function withCheckout(
  fn: (dir: string, store: Map<string, unknown>) => Promise<void>,
) {
  const dir = await appCheckout(REPO, "factory-start-log-");
  try {
    await Deno.writeTextFile(`${dir}/app.json`, APP_SPEC);
    await Deno.writeTextFile(`${dir}/outcome.json`, OUTCOME_SPEC);
    const store = new Map<string, unknown>();
    await model.methods.render.execute(
      model.methods.render.arguments.parse({
        spec: APP_SPEC,
        targetDir: dir,
        repository: REPO,
      }),
      context([], store),
    );
    await fn(dir, store);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const run = {
  prefill: (over: Record<string, unknown>, ctx: ReturnType<typeof context>) =>
    model.methods.prefill.execute(
      model.methods.prefill.arguments.parse(over),
      ctx,
    ),
  render: (over: Record<string, unknown>, ctx: ReturnType<typeof context>) =>
    model.methods.render.execute(
      model.methods.render.arguments.parse({
        repository: REPO,
        overwrite: true,
        ...over,
      }),
      ctx,
    ),
  result: (over: Record<string, unknown>, ctx: ReturnType<typeof context>) =>
    model.methods.result.execute(
      model.methods.result.arguments.parse({
        name: NAME,
        repository: REPO,
        buildRef: `draft/${NAME}`,
        ...over,
      }),
      ctx,
    ),
  visibility: (
    over: Record<string, unknown>,
    ctx: ReturnType<typeof context>,
  ) =>
    model.methods.visibility.execute(
      model.methods.visibility.arguments.parse({
        name: NAME,
        quality: 100,
        repoVisibility: "private",
        ...over,
      }),
      ctx,
    ),
  readiness: (over: Record<string, unknown>, ctx: ReturnType<typeof context>) =>
    model.methods.readiness.execute(
      model.methods.readiness.arguments.parse({
        name: NAME,
        review: "swamp-extension-review/report.json",
        ...over,
      }),
      ctx,
    ),
};

const STARTS: Array<{
  method: keyof typeof run;
  args: (dir: string) => Record<string, unknown>;
  says: (dir: string) => string[];
}> = [
  {
    method: "prefill",
    args: (dir) => ({
      outcomeSpec: `${dir}/outcome.json`,
      out: `${dir}/starter.json`,
    }),
    says: (dir) => [`${dir}/outcome.json`, `${dir}/starter.json`],
  },
  {
    method: "render",
    args: (dir) => ({ spec: `${dir}/app.json`, targetDir: dir }),
    says: (dir) => [`${dir}/app.json`, dir],
  },
  { method: "result", args: () => ({}), says: () => [NAME] },
  {
    method: "visibility",
    args: (dir) => ({ targetDir: dir }),
    says: (dir) => [NAME, dir],
  },
  {
    method: "readiness",
    args: (dir) => ({ targetDir: dir }),
    says: (dir) => [NAME, dir],
  },
];

for (const { method, args, says } of STARTS) {
  Deno.test(`start log: ${method} says what it is doing before any I/O`, async () => {
    await withCheckout(async (dir, store) => {
      const events: string[] = [];
      await recordingIo(
        events,
        () => run[method](args(dir), context(events, store)),
      );
      assertEquals(events[0]?.startsWith("info "), true, events.join("\n"));
      for (const text of says(dir)) assertStringIncludes(events[0], text);
    });
  });
}

for (const method of ["visibility", "readiness"] as const) {
  Deno.test(`start log: ${method} with no targetDir says it uses the draft's checkout`, async () => {
    await withCheckout(async (_dir, store) => {
      const events: string[] = [];
      await recordingIo(
        events,
        () => run[method]({}, context(events, store)),
      );
      assertEquals(events[0]?.startsWith("info "), true, events.join("\n"));
      assertStringIncludes(events[0], NAME);
      assertStringIncludes(events[0], "its draft's checkout");
    });
  });
}

/** The index of the first event starting with prefix; fails when there is none. */
function indexOf(events: string[], prefix: string): number {
  const at = events.findIndex((e) => e.startsWith(prefix));
  assertEquals(at >= 0, true, `no "${prefix}" in:\n${events.join("\n")}`);
  return at;
}

for (
  const { method, args, slow } of [
    {
      method: "prefill" as const,
      args: (dir: string) => ({
        outcomeSpec: `${dir}/outcome.json`,
        out: `${dir}/starter.json`,
      }),
      slow: "io readTextFile",
    },
    {
      method: "render" as const,
      args: (dir: string) => ({ spec: `${dir}/app.json`, targetDir: dir }),
      slow: "io readTextFile",
    },
    {
      method: "visibility" as const,
      args: (dir: string) => ({ targetDir: dir }),
      slow: "io readDir",
    },
    {
      method: "readiness" as const,
      args: (dir: string) => ({ targetDir: dir }),
      slow: "io readDir",
    },
  ]
) {
  Deno.test(`start log: ${method} logs at debug before its slow step`, async () => {
    await withCheckout(async (dir, store) => {
      const events: string[] = [];
      await recordingIo(
        events,
        () => run[method](args(dir), context(events, store)),
      );
      assertEquals(
        indexOf(events, "debug ") < indexOf(events, slow),
        true,
        events.join("\n"),
      );
    });
  });
}

Deno.test("start log: inline spec text is never logged", async () => {
  await withCheckout(async (dir, store) => {
    const events: string[] = [];
    await recordingIo(events, async () => {
      await run.prefill(
        { outcomeSpec: OUTCOME_SPEC, out: `${dir}/starter.json` },
        context(events, store),
      );
      await run.render(
        { spec: APP_SPEC, targetDir: dir },
        context(events, store),
      );
    });
    const logged = events.filter((e) => !e.startsWith("io ")).join("\n");
    assertStringIncludes(logged, "inline JSON");
    const outcome = JSON.parse(OUTCOME_SPEC).specification.problemStatement;
    const app = JSON.parse(APP_SPEC).specification.purpose;
    assertEquals(logged.includes(outcome), false, logged);
    assertEquals(logged.includes(app), false, logged);
  });
});

for (const { method, args } of STARTS) {
  Deno.test(`start log: ${method} keeps no secret from its arguments`, async () => {
    await withCheckout(async (dir, store) => {
      const events: string[] = [];
      const secret = `${dir}/${SECRET}`;
      const given = Object.fromEntries(
        Object.entries(args(dir)).map(([k, v]) => [
          k,
          String(v).replace(dir, secret),
        ]),
      );
      await recordingIo(
        events,
        () => run[method](given, context(events, store)),
      );
      assertEquals(events.join("\n").includes("hunter2"), false, events.join());
    });
  });
}

Deno.test("guarded: debug lines are logged at debug, and keep no secret", () => {
  const events: string[] = [];
  const token = "ghp_" + "a".repeat(36);
  guarded(context(events, new Map())).logger.debug(`x ${token}`, {
    a: [token],
  });
  assertEquals(events.length, 1);
  assertStringIncludes(events[0], "debug x ");
  assertEquals(events[0].includes(token), false, events[0]);
});
