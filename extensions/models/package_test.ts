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
