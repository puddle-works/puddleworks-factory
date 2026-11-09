/**
 * Where a draft may be written: the root of a checkout of the approved app
 * repo, never the Factory's own checkout.
 *
 * `render` calls {@link checkTarget} before it writes anything, and
 * {@link checkOutputPath} for each file. Both read the filesystem and git's
 * own files only; they run no command. They confine what `render` writes, not
 * what an agent does with its own tools.
 *
 * @module
 */

/** The Factory's package name, as its manifest names it. */
export const FACTORY_PACKAGE = "@puddleworks/puddleworks-factory";

/** The Factory's repo, as `owner/name`. */
export const FACTORY_REPO = "puddle-works/puddleworks-factory";

/** What is known about a checkout once it is accepted. */
export interface Target {
  /** The checkout's real, absolute path. */
  root: string;
  /** Its origin, as `owner/name`. */
  origin: string;
  /** The branch checked out, or null on a detached HEAD. */
  branch: string | null;
}

/**
 * `owner/name` of a GitHub repo URL, in lower case: https, ssh or scp form,
 * with or without `.git`. Null for anything else. A login in the URL is
 * dropped, so the result never holds a token.
 */
export function githubRepo(url: string): string | null {
  const m = url.trim().match(
    /^(?:(?:https|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|(?:[^@/]+@)?github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  );
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function lstat(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

/** `path` resolved against `base` when it is relative. */
const against = (base: string, path: string) =>
  path.startsWith("/") ? path : `${base}/${path}`;

/** The parent directory of an absolute path, or null at `/`. */
function parent(path: string): string | null {
  if (path === "/") return null;
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
}

/** Whether `dir` holds the Factory's own manifest. */
async function isFactory(dir: string): Promise<boolean> {
  const manifest = await readText(`${dir}/manifest.yaml`);
  return manifest !== null &&
    new RegExp(`^name:\\s*["']?${FACTORY_PACKAGE}["']?\\s*$`, "m").test(
      manifest,
    );
}

/** The url of `[remote "origin"]` in a git config. */
function originOf(config: string): string | null {
  let inOrigin = false;
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
    } else if (inOrigin) {
      const m = line.match(/^url\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  }
  return null;
}

/**
 * Accept `targetDir` as the place to write a draft for `repository`, or throw
 * saying why. It must be an absolute path to a directory, given as its real
 * path (no symlink or `..` on the way), holding `.swamp.yaml` and the root of
 * a git checkout or worktree whose origin is `repository`, on `branch` when
 * one is given. Neither it nor any directory above it may be the Factory's
 * checkout, and its origin may not be the Factory's repo.
 */
export async function checkTarget(
  targetDir: string,
  repository: string,
  branch?: string,
): Promise<Target> {
  if (!targetDir.startsWith("/")) {
    throw new Error(
      `targetDir must be an absolute path; ${targetDir} is relative.`,
    );
  }
  const root = targetDir.length > 1 ? targetDir.replace(/\/+$/, "") : "/";
  let real: string;
  try {
    real = await Deno.realPath(root);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(`${root} does not exist.`);
    }
    throw e;
  }
  if (real !== root) {
    throw new Error(
      `${root} goes through a symlink or '..' to ${real}. ` +
        "Pass the checkout's real path, so what is approved is what is written.",
    );
  }
  for (let dir: string | null = root; dir !== null; dir = parent(dir)) {
    if (await isFactory(dir)) {
      throw new Error(
        dir === root
          ? `${root} is the Factory's own checkout. Drafts go into the app's own repo; ` +
            "changing the Factory is separate work."
          : `${root} is inside the Factory's checkout at ${dir}. Drafts go into ` +
            "a checkout of the app's own repo, outside the Factory.",
      );
    }
  }
  if (!(await lstat(`${root}/.swamp.yaml`))) {
    throw new Error(
      `${root} does not look like an app repo checkout: it has no .swamp.yaml. ` +
        "Pass targetDir as the path of a checkout of the app's own swamp repo, e.g. a git worktree of it.",
    );
  }

  const dotGit = await lstat(`${root}/.git`);
  if (!dotGit) {
    throw new Error(
      `${root} is not the root of a git checkout: it has no .git. ` +
        "Pass the top of the app repo's checkout or worktree, not a folder inside it.",
    );
  }
  let gitDir = `${root}/.git`;
  if (dotGit.isFile) {
    const m = (await Deno.readTextFile(gitDir)).match(/^gitdir:\s*(.+)$/m);
    if (!m) throw new Error(`${root}/.git is a file with no gitdir line.`);
    gitDir = against(root, m[1].trim());
  } else if (!dotGit.isDirectory) {
    throw new Error(`${root}/.git is neither a directory nor a file.`);
  }
  const common = (await readText(`${gitDir}/commondir`))?.trim();
  const commonDir = common ? against(gitDir, common) : gitDir;

  const want = githubRepo(repository);
  if (want === null) {
    throw new Error(
      "repository must be the https URL of a GitHub repo, e.g. https://github.com/example/my-app.",
    );
  }
  const url = originOf((await readText(`${commonDir}/config`)) ?? "");
  const origin = url === null ? null : githubRepo(url);
  if (origin === null) {
    throw new Error(
      `${root} has no GitHub origin remote, so it can't be shown to be a checkout of ${want}.`,
    );
  }
  if (origin === FACTORY_REPO) {
    throw new Error(
      `${root} is a checkout of the Factory's own repo (${FACTORY_REPO}). ` +
        "Drafts go into the app's own repo.",
    );
  }
  if (origin !== want) {
    throw new Error(
      `${root} is a checkout of ${origin}, not ${want}. Pass a checkout of the app's repo, ` +
        "or the repository it is a checkout of.",
    );
  }

  const head = (await readText(`${gitDir}/HEAD`))?.trim() ?? "";
  const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
  const current = ref ? ref[1] : null;
  if (branch !== undefined && current !== branch) {
    throw new Error(
      `${root} has ${
        current === null ? "a detached HEAD" : `branch ${current}`
      } checked out, not ${branch}.`,
    );
  }
  return { root, origin, branch: current };
}

/**
 * Throw unless `file`, relative to `root`, stays inside it and no part of it
 * that exists is a symlink, so a write there lands in the checkout itself.
 */
export async function checkOutputPath(
  root: string,
  file: string,
): Promise<void> {
  const parts = file.split("/");
  if (
    file.startsWith("/") ||
    parts.some((p) => p === "" || p === "." || p === "..")
  ) {
    throw new Error(`${file} is not a plain path inside the checkout.`);
  }
  let at = root;
  for (const part of parts) {
    at = `${at}/${part}`;
    const info = await lstat(at);
    if (info === null) return;
    if (info.isSymlink) {
      throw new Error(
        `${
          at.slice(root.length + 1)
        } in the checkout is a symlink, so writing ${file} could land outside it. ` +
          "Nothing was written.",
      );
    }
  }
}
