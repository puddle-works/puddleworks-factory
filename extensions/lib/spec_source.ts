/**
 * Read a spec from wherever it is, so Factory can build from an exported
 * outcome spec, an app spec a person wrote by hand, or one another tool
 * published.
 *
 * | `source` starts with | Read as                          |
 * | -------------------- | -------------------------------- |
 * | `{`                  | inline JSON                      |
 * | `https://`           | fetched; JSON or YAML            |
 * | any other `scheme://`| refused                          |
 * | anything else        | a file path; JSON or YAML        |
 *
 * The scheme is read whatever its case, after leading space. A URL is
 * stored, logged and shown without its login or query, where a token may be.
 * The method arguments are not marked sensitive: swamp would then write `***`
 * over every copy of the value in the Factory's records, and it still keeps
 * workflow inputs as given.
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
import { safeText, shownUrl } from "./redact.ts";

/** The file system and network, passed in so tests need neither. */
export interface SpecIo {
  readTextFile: (path: string) => Promise<string>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const FETCH_SECONDS = 30;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

const timedOut = (source: string) =>
  new Error(`${source} did not answer within ${FETCH_SECONDS} seconds.`);

const httpsOnly = (source: string, to: string) =>
  new Error(
    `Refusing ${source}: it redirected to ${to}, and specs are only fetched over https.`,
  );

/**
 * Fetch over https only, following redirects here rather than in fetch, so a
 * hop to http is refused before anything is sent to it. `source` is the URL
 * as it may be shown.
 */
async function fetchHttps(
  start: string,
  source: string,
  io: SpecIo,
  signal: AbortSignal,
): Promise<Response> {
  let url = start;
  for (let hop = 0;; hop++) {
    let res: Response;
    try {
      res = await io.fetch(url, { redirect: "manual", signal });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw timedOut(source);
      throw new Error(
        `Could not fetch ${source}: ${safeText((e as Error).message)}`,
      );
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || location === null) return res;
    await res.body?.cancel();
    if (hop === MAX_REDIRECTS) {
      throw new Error(
        `${source} redirected more than ${MAX_REDIRECTS} times.`,
      );
    }
    let next: string;
    try {
      next = new URL(location, url).href;
    } catch {
      throw new Error(
        `${source} redirected to a Location that is not a URL.`,
      );
    }
    if (!next.startsWith("https://")) {
      throw httpsOnly(source, shownUrl(next));
    }
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
  /** `inline`, or the path or URL the spec was read from, without the URL's login or query. */
  source: string;
}

/** Where a spec is read from, as it may be logged: never the inline spec itself. */
export const sourceLabel = (source: string) =>
  source.trimStart().startsWith("{") ? "inline JSON" : safeText(source.trim());

async function readText(
  given: string,
  io: SpecIo,
): Promise<{ text: string; from: string }> {
  const source = given.trim();
  if (source.startsWith("{")) return { text: given, from: "inline" };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(source)?.[1].toLowerCase();
  if (scheme !== undefined && scheme !== "https") {
    throw new Error(
      `Refusing to fetch ${
        safeText(shownUrl(source))
      }: specs are only fetched over https.`,
    );
  }
  if (scheme === "https") {
    const shown = safeText(shownUrl(source));
    let start: string;
    try {
      start = new URL(source).href;
    } catch {
      throw new Error(`${shown} is not a URL.`);
    }
    const res = await fetchHttps(
      start,
      shown,
      io,
      AbortSignal.timeout(FETCH_SECONDS * 1000),
    );
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`${shown} returned ${res.status}.`);
    }
    try {
      return { text: await cappedText(res, shown), from: shown };
    } catch (e) {
      // The time limit also covers reading the body.
      if ((e as Error).name === "TimeoutError") throw timedOut(shown);
      throw e;
    }
  }
  const path = safeText(source);
  try {
    return { text: await io.readTextFile(source), from: path };
  } catch (e) {
    throw new Error(
      `Could not read ${path}: ${safeText((e as Error).message)}`,
    );
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
