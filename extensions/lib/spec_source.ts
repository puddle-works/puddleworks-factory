/**
 * Read a spec from wherever it is, so Factory can build from an exported
 * outcome spec, an app spec a person wrote by hand, or one another tool
 * published.
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
import { parse as parseYaml } from "jsr:@std/yaml@1.0.12";
import {
  APP_SPEC_V1,
  type AppSpec,
  parseAppSpec,
} from "../contracts/app_spec_v1.ts";
import {
  OUTCOME_SPEC_V1,
  type OutcomeSpec,
  parseOutcomeSpec,
} from "../contracts/outcome_spec_v1.ts";

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

/** Read text as JSON or YAML, saying where it came from when it is neither. */
async function readValue(
  source: string,
  io: SpecIo,
): Promise<{ value: unknown; from: string; where: string }> {
  const { text, from } = await readText(source, io);
  const where = from === "inline" ? "The inline spec" : from;
  try {
    // YAML is a superset of JSON, so one parser reads both.
    return { value: parseYaml(text), from, where };
  } catch (e) {
    throw new Error(
      `${where} is not JSON or YAML: ${(e as Error).message.split("\n")[0]}`,
    );
  }
}

/** Read and check an app spec. Throws a plain-language error naming the source. */
export async function loadAppSpec(
  source: string,
  io: SpecIo,
): Promise<LoadedSpec> {
  const { value, from, where } = await readValue(source, io);
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

/** Read and check an outcome spec, from the same places as an app spec. */
export async function loadOutcomeSpec(
  source: string,
  io: SpecIo,
): Promise<{ spec: OutcomeSpec; source: string }> {
  const { value, from, where } = await readValue(source, io);
  const parsed = parseOutcomeSpec(value);
  if (!parsed.ok) {
    throw new Error(
      `${where} is not a valid ${OUTCOME_SPEC_V1} spec:\n- ${
        parsed.problems.join("\n- ")
      }`,
    );
  }
  return { spec: parsed.spec, source: from };
}
