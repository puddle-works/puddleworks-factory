/**
 * The published package ships the README but not the rest of the repo, so
 * what the README points at must be shipped too, or be an absolute URL.
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parse } from "jsr:@std/yaml@1.0.12";

const ROOT = new URL("../../", import.meta.url);

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

Deno.test("package: the README links and example inputs reach only shipped files or URLs", async () => {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  const manifest = parse(
    await Deno.readTextFile(new URL("manifest.yaml", ROOT)),
  ) as { additionalFiles?: string[] };
  const shipped = new Set(manifest.additionalFiles ?? []);
  const targets = [
    ...[...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...readme.matchAll(/--input \w+=([^\s`]+)/g)].map((m) => m[1]),
  ];
  // Only a path to a file in this repo can be left behind by the package; a
  // value like true, or a path in the app's own checkout, is not one.
  const unshipped = [];
  for (const t of targets) {
    const path = t.split("#")[0];
    if (!path || /^[a-z]+:/.test(path) || shipped.has(path)) continue;
    if (await exists(new URL(path, ROOT))) unshipped.push(t);
  }
  assertEquals(unshipped, []);
});

Deno.test("package: the shipped workflows point at docs by URL, since docs/ is not shipped", async () => {
  const manifest = parse(
    await Deno.readTextFile(new URL("manifest.yaml", ROOT)),
  ) as { workflows?: string[] };
  const bare: string[] = [];
  for (const file of manifest.workflows ?? []) {
    const text = await Deno.readTextFile(new URL(`workflows/${file}`, ROOT));
    for (const m of text.matchAll(/(\S*)docs\/[\w./-]+/g)) {
      if (!m[1].startsWith("https://")) bare.push(`${file}: ${m[0]}`);
    }
  }
  assertEquals(bare, []);
});

Deno.test("package: shipped docs don't lean on Puddleworks' other tools", async () => {
  for (const file of ["README.md", "extensions/models/web.ts"]) {
    const text = await Deno.readTextFile(new URL(file, ROOT));
    assertEquals(/Capture/.test(text), false, `${file} mentions Capture`);
  }
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  // Orca may be named, but only once it is said what it is.
  const first = readme.indexOf("Orca");
  assertEquals(
    first === -1 || /Orca \([^)]*worktree/.test(readme.slice(first)),
    true,
    "the README names Orca without saying what it is",
  );
});

Deno.test("package: the skill says it is Puddleworks' own procedure, and runs on any sed", async () => {
  const skill = await Deno.readTextFile(
    new URL(".claude/skills/factory-build/SKILL.md", ROOT),
  );
  const body = skill.slice(skill.indexOf("\n---", 3) + 4);
  const intro = body.trimStart().split("\n\n").slice(0, 3).join("\n\n");
  assertEquals(/Puddleworks' own/.test(intro), true, intro);
  assertEquals(skill.includes("sed -i ''"), false, "BSD-only sed -i ''");
});
