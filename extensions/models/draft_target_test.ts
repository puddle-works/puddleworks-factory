// render writes only into the root of a checkout of the approved app repo
// (#48). Every refusal writes no file and no resource.
import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { model } from "./draft.ts";
import { appCheckout } from "../lib/target_testing.ts";

const EXAMPLE_TEXT = await Deno.readTextFile(
  new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
);
const REPO = "https://github.com/example/obsidian-puddle-scanner";

function makeContext() {
  const writes: string[] = [];
  return {
    globalArgs: { typeScope: "@puddleworks" },
    logger: { debug: () => {}, info: () => {}, warning: () => {} },
    writeResource(_spec: string, name: string) {
      writes.push(name);
      return Promise.resolve({ name });
    },
    writes,
  };
}

const render = (
  targetDir: string,
  over: Record<string, unknown> = {},
  ctx = makeContext(),
) =>
  model.methods.render.execute(
    model.methods.render.arguments.parse({
      spec: EXAMPLE_TEXT,
      targetDir,
      repository: REPO,
      ...over,
    }),
    ctx,
  );

/** Every file under dir, relative to it. */
async function filesIn(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, at: string) => {
    for await (const e of Deno.readDir(d)) {
      const rel = at ? `${at}/${e.name}` : e.name;
      if (e.isDirectory) await walk(`${d}/${e.name}`, rel);
      else out.push(rel);
    }
  };
  await walk(dir, "");
  return out.sort();
}

/** Expect render to refuse, saying `says`, and leave `watch` unchanged. */
async function refuses(
  targetDir: string,
  says: string,
  watch: string,
  over: Record<string, unknown> = {},
) {
  const before = await filesIn(watch);
  const ctx = makeContext();
  await assertRejects(() => render(targetDir, over, ctx), Error, says);
  assertEquals(ctx.writes, []);
  assertEquals(await filesIn(watch), before);
}

Deno.test("target: a checkout of the app repo is accepted, on the branch asked for", async () => {
  const dir = await appCheckout(REPO, "app-repo-", "draft/obsidian");
  try {
    const ctx = makeContext();
    await render(dir, { branch: "draft/obsidian" }, ctx);
    assertEquals(ctx.writes, ["obsidian-puddle-scanner"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: the Factory's own checkout is refused", async () => {
  const dir = await appCheckout(REPO);
  try {
    await Deno.writeTextFile(
      `${dir}/manifest.yaml`,
      'manifestVersion: 1\nname: "@puddleworks/puddleworks-factory"\n',
    );
    await refuses(dir, "the Factory's own checkout", dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: a checkout inside the Factory's checkout is refused", async () => {
  const factory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "factory-" }),
  );
  try {
    await Deno.writeTextFile(
      `${factory}/manifest.yaml`,
      'name: "@puddleworks/puddleworks-factory"\n',
    );
    const inner = await appCheckout(REPO);
    const nested = `${factory}/apps`;
    await Deno.rename(inner, nested);
    await refuses(nested, "inside the Factory's checkout", factory);
  } finally {
    await Deno.remove(factory, { recursive: true });
  }
});

Deno.test("target: a checkout whose origin is the Factory's repo is refused", async () => {
  const dir = await appCheckout(
    "https://github.com/puddle-works/puddleworks-factory",
  );
  try {
    await refuses(dir, "the Factory's own repo", dir, {
      repository: "https://github.com/puddle-works/puddleworks-factory",
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: a checkout of another repo is refused", async () => {
  const dir = await appCheckout("git@github.com:example/something-else");
  try {
    await refuses(dir, "example/something-else, not example/obsidian", dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: an ssh origin of the same repo is accepted", async () => {
  const dir = await appCheckout(
    "git@github.com:Example/obsidian-puddle-scanner",
  );
  try {
    await render(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: a path through a symlink, or with '..', is refused", async () => {
  const dir = await appCheckout(REPO);
  const link = `${dir}-link`;
  try {
    await Deno.symlink(dir, link);
    await refuses(link, "symlink or '..'", dir);
    await Deno.mkdir(`${dir}/extensions`);
    await refuses(`${dir}/extensions/..`, "symlink or '..'", dir);
  } finally {
    await Deno.remove(link).catch(() => {});
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: a folder inside the checkout, or a relative path, is refused", async () => {
  const dir = await appCheckout(REPO);
  try {
    await Deno.mkdir(`${dir}/sub`);
    await Deno.writeTextFile(`${dir}/sub/.swamp.yaml`, "tools: []\n");
    await refuses(`${dir}/sub`, "not the root of a git checkout", dir);
    await refuses("some/relative/dir", "absolute path", dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: another branch checked out is refused", async () => {
  const dir = await appCheckout(REPO);
  try {
    await refuses(dir, "branch main checked out, not draft/x", dir, {
      branch: "draft/x",
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("target: a draft file whose folder is a symlink out of the checkout writes nothing", async () => {
  const dir = await appCheckout(REPO);
  const outside = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "outside-" }),
  );
  try {
    await Deno.symlink(outside, `${dir}/workflows`);
    await refuses(dir, "workflows in the checkout is a symlink", dir);
    assertEquals(await filesIn(outside), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
