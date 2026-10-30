/**
 * Whether a built app looks fit to share publicly, or should stay private.
 *
 * The same files give the same answer every time. Required checks (licence,
 * repository, quality, no secrets) must pass before the app can be public.
 * Signals (details that look internal, spec wording about who it is for)
 * recommend private but leave the choice to the builder. The repo's own
 * visibility is reported against the manifest's, and decides nothing.
 *
 * @module
 */
import { parse as parseYaml } from "jsr:@std/yaml@1.0.12";
import { exampleDomain, linkProblem, safeText, secretSpans } from "./redact.ts";

/** Registry and repo visibility. */
export type Visibility = "public" | "private";

/** What a finding is. */
export type FindingKind =
  | "secret"
  | "home-path"
  | "internal-host"
  | "private-ip"
  | "email"
  | "audience";

/**
 * One thing that looks internal, and only that: never its line. A secret's
 * text is never repeated, and an email is kept as its domain.
 */
export interface Finding {
  file: string;
  line: number;
  kind: FindingKind;
  text: string;
}

/** `required` must pass to go public; `signal` recommends private; `info` decides nothing. */
export type CheckRole = "required" | "signal" | "info";

/** One check and what it found, in plain words. */
export interface Check {
  id: string;
  role: CheckRole;
  ok: boolean;
  detail: string;
}

/** The answer, with every check that led to it. */
export interface Assessment {
  recommendation: Visibility;
  /** Every required check passed. */
  canBePublic: boolean;
  /** The manifest's `visibility:`, or null when there is no readable manifest. */
  manifestVisibility: Visibility | null;
  checks: Check[];
  findings: Finding[];
}

/** What the assessment reads: the repo's text files, and two facts from outside it. */
export interface RepoFacts {
  /** Text files, with paths relative to the repo root. */
  files: Array<{ path: string; text: string }>;
  /** `swamp extension quality --json` percentage. */
  quality: number;
  /** The repo's visibility on GitHub. */
  repoVisibility: Visibility;
  /** What the scan skipped and why, e.g. `data/big.json (over 512 KB)`. */
  notRead?: string[];
}

/** What looks internal. Secrets are found by `secretSpans`. */
const PATTERNS: Array<
  { kind: Exclude<FindingKind, "secret" | "audience">; re: RegExp }
> = [
  {
    kind: "internal-host",
    re:
      /\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|intranet|home\.arpa)(?![\w-]|\.\w)/gi,
  },
  {
    kind: "private-ip",
    re:
      /\b(?:10\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3})\.\d{1,3}\b/g,
  },
  {
    kind: "home-path",
    re: /(?:\/Users|\/home)\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\/g,
  },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

/** Addresses that name nobody: documentation domains and no-reply senders. */
function harmlessEmail(address: string): boolean {
  const [local, domain] = address.toLowerCase().split("@");
  return /^no-?reply\b/.test(local) || exampleDomain(domain) ||
    domain === "users.noreply.github.com";
}

const clip = (s: string) => {
  const t = s.trim();
  return t.length > 120 ? `${t.slice(0, 117)}...` : t;
};

/** A match as a finding keeps it: an email as its domain. */
const shown = (kind: FindingKind, match: string) =>
  clip(kind === "email" ? `…@${match.slice(match.indexOf("@") + 1)}` : match);

/**
 * A finding's text as it may be shown, also for records written before
 * 2026.10.30.1, which kept the whole line: only what its kind matches in it.
 */
export function findingText(kind: string, text: string): string {
  if (kind === "audience") return AUDIENCE.exec(text)?.[0] ?? "(hidden)";
  const pattern = PATTERNS.find((p) => p.kind === kind);
  if (!pattern) return "(hidden)";
  const spans = secretSpans(text);
  for (const m of text.matchAll(pattern.re)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (!spans.some(([s, e]) => at < e && end > s)) {
      return shown(pattern.kind, m[0]);
    }
  }
  return "(hidden)";
}

/** Source code, where a value without quotes is an expression, not a secret. */
const SOURCE_CODE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kts?|rb|php|cs|swift|scala|dart)$/i;

/** Every line of one file that looks internal or holds a secret. */
export function scanFile(path: string, text: string): Finding[] {
  const found: Array<Finding & { at: number }> = [];
  const code = SOURCE_CODE.test(path);
  text.split("\n").forEach((line, i) => {
    const secrets = secretSpans(line, { code });
    for (const [at] of secrets) {
      found.push({
        file: path,
        line: i + 1,
        kind: "secret",
        text: "(hidden)",
        at,
      });
    }
    for (const { kind, re } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        const at = m.index ?? 0;
        const end = at + m[0].length;
        // Part of a secret, like the password@host of a URL: the secret covers it.
        if (secrets.some(([s, e]) => at < e && end > s)) continue;
        if (kind === "email" && harmlessEmail(m[0])) continue;
        // Only what matched, never the line, which may hold a secret no pattern knows.
        found.push({
          file: path,
          line: i + 1,
          kind,
          text: shown(kind, m[0]),
          at,
        });
      }
    }
  });
  // Lines in order; within a line, left to right.
  found.sort((a, b) => a.line - b.line || a.at - b.at);
  return found.map(({ at: _at, ...f }) => f);
}

/** Wording that says an app is for one team or holds data that is not to be shared. */
const AUDIENCE =
  /\b(internal(ly)?|in-house|confidential|proprietary|private|our (team|company|staff|clients|customers|business)|personal data|customer data|do not share|not (to be|for) shar(ed|ing))\b/i;

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => stringsIn(v, out));
  }
  return out;
}

/** Specification text in `spec/*.json` that says who the app is for. */
function audienceFindings(path: string, text: string): Finding[] {
  let spec: unknown;
  try {
    spec = (JSON.parse(text) as { specification?: unknown }).specification;
  } catch {
    return [];
  }
  return stringsIn(spec).flatMap((s) => {
    const words = AUDIENCE.exec(s)?.[0];
    if (words === undefined) return [];
    const at = text.indexOf(JSON.stringify(s).slice(1, -1));
    const line = at < 0 ? 0 : text.slice(0, at).split("\n").length;
    // The words that matched, not the sentence around them.
    return [{ file: path, line, kind: "audience" as const, text: words }];
  });
}

function summarise(findings: Finding[]): string {
  const where = [...new Set(findings.map((f) => `${f.file}:${f.line}`))];
  const kinds = [...new Set(findings.map((f) => f.kind))].join(", ");
  return `${findings.length} found (${kinds}): ${where.slice(0, 5).join(", ")}${
    where.length > 5 ? ", ..." : ""
  }`;
}

/** Recommend public or private for the repo's files, and say why. */
export function assessVisibility(facts: RepoFacts): Assessment {
  const file = (p: string) => facts.files.find((f) => f.path === p);
  let manifest: Record<string, unknown> | null = null;
  try {
    const raw = file("manifest.yaml");
    const parsed = raw ? parseYaml(raw.text) : null;
    if (parsed && typeof parsed === "object") {
      manifest = parsed as Record<string, unknown>;
    }
  } catch {
    manifest = null;
  }
  const field = (k: string) =>
    typeof manifest?.[k] === "string" ? (manifest[k] as string) : "";
  const declared = field("visibility");
  const manifestVisibility: Visibility | null = manifest
    ? (declared === "public" ? "public" : "private")
    : null;
  const noManifest = "there is no readable manifest.yaml";

  const findings = facts.files.flatMap((f) => [
    ...scanFile(f.path, f.text),
    ...(f.path.startsWith("spec/") && f.path.endsWith(".json")
      ? audienceFindings(f.path, f.text)
      : []),
  ]).map((f) => ({ ...f, file: safeText(f.file) }));
  const secrets = findings.filter((f) => f.kind === "secret");
  const internal = findings.filter((f) =>
    f.kind !== "secret" && f.kind !== "audience"
  );
  const audience = findings.filter((f) => f.kind === "audience");

  const licence = field("license");
  const repository = field("repository");
  const repositoryProblem = repository === ""
    ? null
    : linkProblem(repository) ??
      (/^https:\/\/[^/]+\/./.test(repository) ? null : "names no repo");
  const checks: Check[] = [
    {
      id: "licence",
      role: "required",
      ok: licence !== "" && file("LICENSE") !== undefined,
      detail: !manifest
        ? noManifest
        : licence === ""
        ? "manifest.yaml has no license:"
        : file("LICENSE")
        ? `license: ${licence}, and a LICENSE file`
        : `license: ${licence}, but there is no LICENSE file`,
    },
    {
      id: "repository",
      role: "required",
      ok: repository !== "" && repositoryProblem === null,
      detail: !manifest
        ? noManifest
        : repository === ""
        ? "manifest.yaml has no repository:"
        : repositoryProblem
        ? `repository: ${repository} ${repositoryProblem}: use the plain https URL of the repo, and let git find any credentials`
        : `repository: ${repository}`,
    },
    {
      id: "quality",
      role: "required",
      ok: facts.quality >= 100,
      detail: facts.quality >= 100
        ? "quality 100%"
        : `quality ${facts.quality}%: below 100%`,
    },
    {
      id: "secrets",
      role: "required",
      ok: secrets.length === 0,
      detail:
        (secrets.length === 0
          ? "no secrets found"
          : `remove them, and rotate them: ${summarise(secrets)}`) +
        (facts.notRead?.length
          ? `; not read: ${facts.notRead.join(", ")}`
          : ""),
    },
    {
      id: "internal-details",
      role: "signal",
      ok: internal.length === 0,
      detail: internal.length === 0
        ? "no paths, hosts, addresses or emails that look internal"
        : summarise(internal),
    },
    {
      id: "audience",
      role: "signal",
      ok: audience.length === 0,
      detail: audience.length === 0
        ? "nothing in spec/ says it is for one team only"
        : summarise(audience),
    },
    {
      id: "repo-visibility",
      role: "info",
      ok: facts.repoVisibility === manifestVisibility,
      detail: `the repo is ${facts.repoVisibility}; the manifest says ${
        manifestVisibility ?? "nothing"
      }`,
    },
  ];

  // Details copy manifest values and file names as written: hide any secret in them.
  for (const c of checks) c.detail = safeText(c.detail);

  const canBePublic = checks.every((c) => c.role !== "required" || c.ok);
  const signalsClear = checks.every((c) => c.role !== "signal" || c.ok);
  return {
    recommendation: canBePublic && signalsClear ? "public" : "private",
    canBePublic,
    manifestVisibility,
    checks,
    findings,
  };
}
