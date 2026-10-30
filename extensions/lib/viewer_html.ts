/**
 * The viewer's pages, rendered on the server as Capture's page looks: the
 * overview at `/`, one app at `/apps/<name>`, and not found.
 *
 * Every value from swamp data is escaped, and an address is linked only when
 * it is http or https. The pages carry no forms, buttons or inline script or
 * style: the CSP is `default-src 'self'`, and the only script is
 * `/reload.js`, which reloads the page when the data changes.
 *
 * @module
 */
import {
  type App,
  grouped,
  type Stage,
  stageOf,
  STAGES,
  timeline,
  updatedAt,
  waitingOnPerson,
} from "./viewer_apps.ts";

/** How many apps each group shows before "Show all". */
export const RECENT_PER_GROUP = 5;

/** Where a published package is on the registry. */
export const registryUrl = (extension: string) =>
  `https://swamp-club.com/extensions/${extension}`;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text made safe for HTML content and attribute values. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** A link to another site, or the address as plain text when it isn't http or https. */
function link(url: string, text = url): string {
  return isWebUrl(url)
    ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(text)}</a>`
    : esc(text);
}

const appHref = (name: string) => `/apps/${encodeURIComponent(name)}`;

const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "22 Oct 2026, 3:04 pm", in the server's time zone: the page is local. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : when.format(date);
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const STAGE = Object.fromEntries(STAGES.map((s) => [s.stage, s]));

function badge(stage: Stage): string {
  const { badge, heading } = STAGE[stage];
  return `<span class="badge badge-${badge}">${
    esc(stage === "ready" ? "Ready to publish" : heading)
  }</span>`;
}

const LOGO =
  `<svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
<circle cx="16" cy="7" r="3" fill="currentColor"/>
<ellipse cx="16" cy="19" rx="5" ry="2.25" fill="currentColor"/>
<ellipse cx="16" cy="19" rx="9" ry="4.5" stroke="currentColor" stroke-width="1.5" opacity="0.55"/>
<ellipse cx="16" cy="19" rx="14" ry="7" stroke="currentColor" stroke-width="1" opacity="0.25"/>
</svg>`;

/** The page around a view: Capture's head and header. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/web.css">
<script src="/reload.js" defer></script>
<title>${esc(title)} — Factory</title>
</head>
<body>
<header>
<a class="brand" href="/">${LOGO}
<span class="brand-name">puddle <span class="brand-accent">works</span></span>
<span class="brand-app">Factory</span></a>
<span class="read-only" title="Changes go through the draft behavior's methods">Read-only</span>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

/** What a card says after "updated": what the app's stage is waiting on. */
function cardNote(app: App, stage: Stage): string | undefined {
  const { prefill, draft, visibility, readiness, buildResult } = app;
  switch (stage) {
    case "to_decide":
      return prefill && prefill.toDecide.length > 0
        ? `${plural(prefill.toDecide.length, "thing")} to decide`
        : "nothing left to decide";
    case "drafted":
      return draft ? plural(draft.files.length, "file") : undefined;
    case "visibility_checked":
      return visibility && `recommends ${visibility.recommendation}`;
    case "blocked":
      return readiness && plural(readiness.blockers.length, "blocker");
    case "ready":
      return buildResult?.pullRequest || readiness?.pullRequest
        ? "PR open"
        : "no pull request yet";
    case "released":
      return buildResult?.published &&
        `${buildResult.published.version}, ${buildResult.published.visibility}`;
  }
}

function card(app: App): string {
  const stage = stageOf(app);
  const note = cardNote(app, stage);
  return `<div class="${waitingOnPerson(stage) ? "card waiting" : "card"}">
<div class="card-title"><a href="${esc(appHref(app.name))}">${esc(app.name)}</a>
<div class="card-meta">updated ${esc(formatTime(updatedAt(app)))}${
    note ? ` · ${esc(note)}` : ""
  }</div></div>
${badge(stage)}
</div>`;
}

/** Every app, grouped by the stage it is at. */
export function overviewPage(apps: App[], readAt: string): string {
  const groups = grouped(apps);
  const waiting = apps.filter((a) => waitingOnPerson(stageOf(a))).length;
  const sections = groups.map((g) => {
    const id = `group-${g.stage}`;
    const recent = g.apps.slice(0, RECENT_PER_GROUP);
    const rest = g.apps.slice(RECENT_PER_GROUP);
    return `<section aria-labelledby="${id}">
<h2 id="${id}">${esc(g.heading)}</h2>
${recent.map(card).join("\n")}${
      rest.length > 0
        ? `\n<details class="show-all"><summary><span class="when-closed">Show all ${g.apps.length}</span><span class="when-open">Show fewer</span></summary>
${rest.map(card).join("\n")}
</details>`
        : ""
    }
</section>`;
  });
  const body = [
    "<h1>Apps</h1>",
    waiting > 0
      ? `<p class="waiting-note">${
        plural(waiting, "app")
      } waiting on you: each one needs a decision or a fix before it can move on.</p>`
      : "",
    apps.length === 0
      ? `<p class="empty">No apps yet. Start one with <code>swamp workflow run @puddleworks/puddleworks-factory-prefill</code>.</p>`
      : sections.join("\n"),
    `<p class="card-meta read-at">Read ${esc(formatTime(readAt))}</p>`,
  ].filter((s) => s !== "");
  return page("Apps", body.join("\n"));
}

const NOT_STARTED = `<p class="empty">Not started.</p>`;

function section(id: string, heading: string, body: string): string {
  return `<section aria-labelledby="${id}-heading">
<h2 id="${id}-heading">${esc(heading)}</h2>
${body}
</section>`;
}

/** Label and value rows. Values are HTML the caller has already escaped. */
function facts(rows: Array<[string, string | undefined]>): string {
  const shown = rows.filter((r): r is [string, string] => r[1] !== undefined);
  return `<dl class="facts">
${
    shown.map(([label, value]) =>
      `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`
    ).join("\n")
  }
</dl>`;
}

function list(items: string[], cls?: string): string {
  return `<ul${cls ? ` class="${cls}"` : ""}>${
    items.map((i) => `<li>${i}</li>`).join("")
  }</ul>`;
}

const code = (value: string) => `<code>${esc(value)}</code>`;

function problems(intro: string, items: string[]): string {
  return items.length === 0
    ? ""
    : `<div class="problems"><p>${esc(intro)}</p>${list(items.map(esc))}</div>`;
}

function stagesSection(app: App): string {
  const steps = timeline(app).map((s) => {
    const cls = s.state === "current"
      ? ` class="current"`
      : s.state === "not_started"
      ? ` class="todo"`
      : "";
    return `<li${cls}><div class="tl-label">${esc(s.label)}</div>
<div class="tl-meta">${s.at ? esc(formatTime(s.at)) : "Not started"}</div>${
      s.note ? `\n<div class="tl-note">${esc(s.note)}</div>` : ""
    }</li>`;
  });
  return section(
    "stages",
    "Stages",
    `<ol class="timeline">\n${steps.join("\n")}\n</ol>`,
  );
}

function prefillSection(app: App): string {
  const p = app.prefill;
  if (!p) return section("prefill", "Prefill", NOT_STARTED);
  const source = p.source.version === undefined
    ? link(p.source.url)
    : `${link(p.source.url)} (version ${esc(p.source.version)})`;
  return section(
    "prefill",
    "Prefill",
    [
      `<p class="card-meta">Prefilled ${esc(formatTime(p.prefilledAt))}</p>`,
      facts([
        ["Outcome spec", source],
        ["Read from", code(p.specSource)],
        ["App spec", code(p.out)],
      ]),
      p.toDecide.length > 0
        ? problems("Still to decide:", p.toDecide)
        : `<p>Nothing left to decide.</p>`,
      problems("Sort out before building:", p.warnings),
    ].filter((s) => s !== "").join("\n"),
  );
}

function draftSection(app: App): string {
  const d = app.draft;
  if (!d) return section("draft", "Draft", NOT_STARTED);
  return section(
    "draft",
    "Draft",
    [
      `<p class="card-meta">Rendered ${esc(formatTime(d.renderedAt))}</p>`,
      facts([
        ["Type", code(d.modelType)],
        ["Entry point", code(d.entryPointRef)],
        ["Written to", code(d.targetDir)],
        ["Repository", d.repository ? link(d.repository) : undefined],
        ["Visibility", d.visibility && esc(d.visibility)],
      ]),
      `<h3>${esc(plural(d.files.length, "file"))}</h3>`,
      d.files.length > 0
        ? list(d.files.map(code), "files")
        : `<p class="empty">None.</p>`,
      d.overwrote.length > 0
        ? `<h3>Replaced</h3>\n${list(d.overwrote.map(code), "files")}`
        : "",
    ].filter((s) => s !== "").join("\n"),
  );
}

const PASSED = `<span class="badge badge-delivered">Passed</span>`;
const FAILED = `<span class="badge badge-closed">Failed</span>`;

function visibilitySection(app: App): string {
  const v = app.visibility;
  if (!v) return section("visibility", "Visibility", NOT_STARTED);
  const checks = v.checks.map((c) =>
    `<div><dt>${esc(c.id)}</dt><dd>${
      c.ok ? PASSED : FAILED
    } <span class="card-meta">${esc(c.role)}</span> ${esc(c.detail)}</dd></div>`
  );
  const findings = v.findings.map((f) =>
    `${code(`${f.file}:${f.line}`)} ${esc(f.kind)}: ${esc(f.text)}`
  );
  return section(
    "visibility",
    "Visibility",
    [
      `<p class="card-meta">Checked ${esc(formatTime(v.assessedAt))}</p>`,
      `<p><span class="badge ${
        v.recommendation === "public" ? "badge-active" : "badge-draft"
      }">Recommends ${esc(v.recommendation)}</span> ${
        v.canBePublic
          ? "Every required check passed, so it can be public."
          : "A required check failed, so it must stay private."
      }</p>`,
      facts([
        ["Manifest", esc(v.manifestVisibility ?? "not set")],
        ["Repository", esc(v.repoVisibility)],
      ]),
      "<h3>Checks</h3>",
      checks.length > 0
        ? `<dl class="criteria checks">\n${checks.join("\n")}\n</dl>`
        : `<p class="empty">None.</p>`,
      "<h3>Findings</h3>",
      findings.length > 0 ? list(findings) : `<p class="empty">None.</p>`,
    ].join("\n"),
  );
}

function readinessSection(app: App): string {
  const r = app.readiness;
  if (!r) return section("readiness", "Readiness", NOT_STARTED);
  const review = r.review
    ? [
      `<p>${code(r.review.file)} reviewed ${esc(r.review.reviewedAt)}: ${
        esc(
          `${r.review.counts.pass} pass · ${r.review.counts.na} n/a · ${
            plural(r.review.counts.issue, "issue")
          } · ${r.review.counts.pending} pending`,
        )
      }</p>`,
      r.review.issues.length > 0
        ? list(r.review.issues.map((i) => `${code(i.id)} ${esc(i.note)}`))
        : "",
    ].filter((s) => s !== "").join("\n")
    : `<p class="empty">No review found at ${code(r.reviewFile)}.</p>`;
  const criteria = r.criteria.map((c) => {
    const tests = c.tests.length > 0 ? list(c.tests.map(code), "tests") : "";
    const manual = c.manual.trim()
      ? `<span class="card-meta">Checked by hand: ${esc(c.manual)}</span>`
      : "";
    return `<div><dt>${esc(c.id)}</dt><dd>${c.ok ? PASSED : FAILED} ${
      esc(c.text)
    }${tests}${manual}</dd></div>`;
  });
  return section(
    "readiness",
    "Readiness",
    [
      `<p class="card-meta">Checked ${esc(formatTime(r.assessedAt))}</p>`,
      `<p>${
        r.ready
          ? `<span class="badge badge-active">Ready to publish</span>`
          : `<span class="badge badge-closed">Blocked</span>`
      }</p>`,
      problems("Before it can be published:", r.blockers),
      facts([
        [
          "Package",
          r.package
            ? code(r.version ? `${r.package}@${r.version}` : r.package)
            : undefined,
        ],
        ["Visibility", r.visibility ? esc(r.visibility) : undefined],
        [
          "Recommended",
          r.recommendation ? esc(r.recommendation) : "not checked yet",
        ],
        ["Pull request", r.pullRequest ? link(r.pullRequest) : undefined],
        ["Commit", r.commit ? code(r.commit) : undefined],
      ]),
      "<h3>Review</h3>",
      review,
      "<h3>Acceptance criteria</h3>",
      criteria.length > 0
        ? `<dl class="criteria">\n${criteria.join("\n")}\n</dl>`
        : `<p class="empty">None.</p>`,
      "<h3>Summary</h3>",
      `<pre class="summary">${esc(r.summary)}</pre>`,
    ].filter((s) => s !== "").join("\n"),
  );
}

function buildResultSection(app: App): string {
  const b = app.buildResult;
  if (!b) return section("build-result", "Build result", NOT_STARTED);
  return section(
    "build-result",
    "Build result",
    [
      `<p class="card-meta">Recorded ${esc(formatTime(b.builtAt))}</p>`,
      facts([
        ["Repository", link(b.repository)],
        ["Pull request", b.pullRequest ? link(b.pullRequest) : "None yet"],
        ["Build ref", code(b.buildRef)],
        ["Extension", code(b.extension)],
        ["Entry point", code(b.entryPointRef)],
        [
          "Package",
          b.published
            ? `${link(registryUrl(b.extension), b.extension)} ${
              esc(`${b.published.version}, ${b.published.visibility}`)
            }`
            : "Not published yet",
        ],
        ["Agreed at", b.source ? link(b.source.url) : undefined],
      ]),
    ].join("\n"),
  );
}

/** One app: where it is, then each of its records in Factory order. */
export function appPage(app: App, readAt: string): string {
  const stage = stageOf(app);
  const repository = app.buildResult?.repository ?? app.draft?.repository;
  const meta = [
    badge(stage),
    `<span>Updated ${esc(formatTime(updatedAt(app)))}</span>`,
    repository ? `<span>${link(repository)}</span>` : "",
  ].filter((s) => s !== "");
  const body = [
    `<a class="back-link" href="/">All apps</a>`,
    `<div class="show-header">
<h1>${esc(app.name)}</h1>
<div class="show-meta">${meta.join("\n")}</div>
</div>`,
    stagesSection(app),
    prefillSection(app),
    draftSection(app),
    visibilitySection(app),
    readinessSection(app),
    buildResultSection(app),
    `<p class="card-meta read-at">Read ${esc(formatTime(readAt))}</p>`,
  ];
  return page(app.name, body.join("\n"));
}

/** A page the viewer doesn't have, or an app it has no records for. */
export function notFoundPage(): string {
  return page(
    "Not found",
    `<h1>Not found</h1>
<p>There is no such page. <a href="/">See every app</a>.</p>`,
  );
}
