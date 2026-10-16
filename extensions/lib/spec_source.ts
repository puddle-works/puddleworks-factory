/**
 * Read an app spec from wherever it is, so Factory can build from a spec that
 * puddleworks-capture exported, one a person wrote by hand, or one another
 * tool published.
 *
 * | `source` starts with | Read as                          |
 * | -------------------- | -------------------------------- |
 * | `{`                  | inline JSON                      |
 * | `https://`           | fetched; JSON or YAML            |
 * | `http://`            | refused                          |
 * | anything else        | a file path; JSON or YAML        |
 *
 * @module
 */
import { parse as parseYaml } from "jsr:@std/yaml@1";
import {
  APP_SPEC_V1,
  type AppSpec,
  parseAppSpec,
} from "../contracts/app_spec_v1.ts";

/** The file system and network, passed in so tests need neither. */
export interface SpecIo {
  readTextFile: (path: string) => Promise<string>;
  fetch: (url: string) => Promise<Response>;
}

export interface LoadedSpec {
  spec: AppSpec;
  /** `inline`, or the path or URL the spec was read from. */
  source: string;
}

async function readText(
  source: string,
  io: SpecIo,
): Promise<{ text: string; from: string }> {
  if (source.trimStart().startsWith("{")) {
    return { text: source, from: "inline" };
  }
  if (source.startsWith("http://")) {
    throw new Error(
      `Refusing to fetch ${source}: specs are only fetched over https.`,
    );
  }
  if (source.startsWith("https://")) {
    let res: Response;
    try {
      res = await io.fetch(source);
    } catch (e) {
      throw new Error(`Could not fetch ${source}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`${source} returned ${res.status}.`);
    }
    return { text: await res.text(), from: source };
  }
  try {
    return { text: await io.readTextFile(source), from: source };
  } catch (e) {
    throw new Error(`Could not read ${source}: ${(e as Error).message}`);
  }
}

/** Read and check an app spec. Throws a plain-language error naming the source. */
export async function loadAppSpec(
  source: string,
  io: SpecIo,
): Promise<LoadedSpec> {
  const { text, from } = await readText(source, io);
  const where = from === "inline" ? "The inline spec" : from;
  let value: unknown;
  try {
    // YAML is a superset of JSON, so one parser reads both.
    value = parseYaml(text);
  } catch (e) {
    throw new Error(
      `${where} is not JSON or YAML: ${(e as Error).message.split("\n")[0]}`,
    );
  }
  const parsed = parseAppSpec(value);
  if (!parsed.ok) {
    throw new Error(
      `${where} is not a valid ${APP_SPEC_V1} spec:\n- ${
        parsed.problems.join("\n- ")
      }`,
    );
  }
  return { spec: parsed.spec, source: from };
}
