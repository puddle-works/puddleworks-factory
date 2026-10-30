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
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const FETCH_SECONDS = 30;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

const httpsOnly = (source: string, to: string) =>
  new Error(
    `Refusing ${source}: it redirected to ${to}, and specs are only fetched over https.`,
  );

/**
 * Fetch over https only, following redirects here rather than in fetch, so a
 * hop to http is refused before anything is sent to it.
 */
async function fetchHttps(
  source: string,
  io: SpecIo,
  signal: AbortSignal,
): Promise<Response> {
  let url = source;
  for (let hop = 0;; hop++) {
    let res: Response;
    try {
      res = await io.fetch(url, { redirect: "manual", signal });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") {
        throw new Error(
          `${source} did not answer within ${FETCH_SECONDS} seconds.`,
        );
      }
      throw new Error(`Could not fetch ${source}: ${(e as Error).message}`);
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || location === null) return res;
    await res.body?.cancel();
    if (hop === MAX_REDIRECTS) {
      throw new Error(
        `${source} redirected more than ${MAX_REDIRECTS} times.`,
      );
    }
    const next = new URL(location, url).href;
    if (!next.startsWith("https://")) throw httpsOnly(source, next);
    url = next;
  }
}

/** The body as text, refusing it once it passes MAX_BYTES. */
async function cappedText(res: Response, source: string): Promise<string> {
  const tooBig = () => new Error(`${source} is over 1 MB, too big for a spec.`);
  if (Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body?.cancel();
    throw tooBig();
  }
  if (!res.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw tooBig();
    chunks.push(chunk);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
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
    const res = await fetchHttps(
      source,
      io,
      AbortSignal.timeout(FETCH_SECONDS * 1000),
    );
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`${source} returned ${res.status}.`);
    }
    return { text: await cappedText(res, source), from: source };
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
