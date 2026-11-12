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

/** Run git in dir, failing the test when it fails. */
export async function gitIn(dir: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: dir,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout);
  if (out.code !== 0) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return text;
}

/**
 * Like appCheckout, but a real git repository on `branch`, so methods that
 * run git can read its commits. `commit` commits everything in it.
 */
export async function gitCheckout(
  repository: string,
  prefix = "app-git-",
  branch = "main",
): Promise<{ dir: string; commit: (message?: string) => Promise<string> }> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix }));
  await gitIn(dir, "init", "-q", "-b", branch);
  await gitIn(dir, "config", "user.email", "test@example.com");
  await gitIn(dir, "config", "user.name", "Test");
  await gitIn(dir, "config", "commit.gpgsign", "false");
  // Only the repo's own hooks, none of them: a global one can add trailers.
  await gitIn(dir, "config", "core.hooksPath", ".git/hooks");
  await gitIn(dir, "remote", "add", "origin", `${repository}.git`);
  await Deno.writeTextFile(`${dir}/.swamp.yaml`, "tools:\n  - claude\n");
  const commit = async (message = "change") => {
    await gitIn(dir, "add", "-A");
    await gitIn(dir, "commit", "-q", "--allow-empty", "-m", message);
    return (await gitIn(dir, "rev-parse", "HEAD")).trim();
  };
  return { dir, commit };
}
