/**
 * Test support: a throwaway checkout of an app repo that `render` accepts.
 *
 * @module
 */

/**
 * A new directory, by its real path, holding `.swamp.yaml` and a `.git` whose
 * origin is `repository` and whose HEAD is `branch`, like a fresh clone made
 * from the template, with nothing committed. No git command runs.
 */
export async function appCheckout(
  repository: string,
  prefix = "app-repo-",
  branch = "main",
): Promise<string> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix }));
  await Deno.writeTextFile(`${dir}/.swamp.yaml`, "tools:\n  - claude\n");
  // objects/ and refs/ make it a repo git reads, with nothing committed yet.
  await Deno.mkdir(`${dir}/.git/objects`, { recursive: true });
  await Deno.mkdir(`${dir}/.git/refs/heads`, { recursive: true });
  await Deno.writeTextFile(`${dir}/.git/HEAD`, `ref: refs/heads/${branch}\n`);
  await Deno.writeTextFile(
    `${dir}/.git/config`,
    `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${repository}.git\n` +
      `\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
  );
  return dir;
}
