/**
 * git, as the `round` method runs it to read the app repo's history.
 *
 * @module
 */

/** Run git with args in cwd. */
export type GitRun = (
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const decoder = new TextDecoder();

/** git itself. It only reads: status, show, diff, log, ls-tree, rev-parse. */
export const realGit: GitRun = async (args, cwd) => {
  // No shell is involved, so each argument stays one; the README says the
  // round method starts git.
  // swamp-quality-ignore deno-command
  const run = await new Deno.Command("git", {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(60_000),
  }).output();
  return {
    code: run.code,
    stdout: decoder.decode(run.stdout),
    stderr: decoder.decode(run.stderr),
  };
};

/** git's output, or an error that says which command failed and why. */
export async function git(
  run: GitRun,
  args: string[],
  cwd: string,
): Promise<string> {
  const out = await run(args, cwd);
  if (out.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${
        (out.stderr || out.stdout).trim().split("\n").at(-1) ?? ""
      }`,
    );
  }
  return out.stdout;
}
