/**
 * The docs and the skill say request or extension, not puddle. Names keep the
 * word: repos, files, types, skills and hyphenated forms.
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";

const ROOT = new URL("../../", import.meta.url);

/** "puddle" or "puddles" as a word of its own, not part of a name. */
const PUDDLE_WORD = /(?<![-_/@.\w])puddles?(?![-_/\w])(?!\.\w)/i;

/** A heading in the template repo, which names it; the template decides it. */
const TEMPLATE_HEADING = '"Puddle repo"';

/** The Markdown and JSON files under a directory. */
async function docFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) found.push(...await docFiles(path));
    else if (/\.(md|json)$/.test(e.name)) found.push(path);
  }
  return found;
}

Deno.test("prose: the check finds the word and leaves names alone", () => {
  const flagged = [
    "build this puddle",
    "publish this puddle.",
    "Puddles are built here",
    "could become puddle requests",
    '"publish this puddle"',
  ];
  const names = [
    "puddle-template",
    "puddle.mk",
    "puddles/<name>/",
    "@mesgme/puddleworks-capture/puddle",
    "obsidian-puddle-scanner",
    "Puddleworks",
    "puddlerouter",
    "new-puddle",
  ];
  for (const text of flagged) assertEquals(PUDDLE_WORD.test(text), true, text);
  for (const text of names) assertEquals(PUDDLE_WORD.test(text), false, text);
});

Deno.test("prose: the README, the skill and the docs don't say puddle", async () => {
  const files = [
    new URL("README.md", ROOT).pathname,
    new URL(".claude/skills/factory-build/SKILL.md", ROOT).pathname,
  ];
  files.push(...await docFiles(new URL("docs", ROOT).pathname));
  const found: string[] = [];
  for (const file of files) {
    const text = (await Deno.readTextFile(file)).replace(/\s+/g, " ")
      .replaceAll(TEMPLATE_HEADING, "");
    const m = text.match(PUDDLE_WORD);
    if (m) {
      found.push(`${file}: ${text.slice(m.index! - 30, m.index! + 30)}`);
    }
  }
  assertEquals(found, []);
});
