/**
 * The viewer's pages, rendered on the server with Preact as Capture's page
 * is: the overview at `/`, one app at `/apps/<name>`, and not found. The
 * components call `h()` in `.ts`, because the swamp registry rejects `.tsx`.
 *
 * Every value from swamp data goes through {@link safe}, Preact escapes it,
 * and an address is linked only when it is http or https. The pages carry no
 * forms, buttons or inline script or style: the CSP is `default-src 'self'`,
 * and the only script is `/reload.js`, which reloads the page when the data
 * changes.
 *
 * @module
 */
import { type ComponentChildren, Fragment, h } from "preact";
import { renderToString } from "preact-render-to-string";
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
import { safeText } from "./redact.ts";
import { findingText } from "./visibility.ts";

/** How many apps each group shows before "Show all". */
export const RECENT_PER_GROUP = 5;

/** Where a published package is on the registry. */
export const registryUrl = (extension: string) =>
  `https://swamp-club.com/extensions/${extension}`;

/**
 * Text without any secret, for Preact to escape. Records written before
 * 2026.10.30.1 may hold a URL login or query, or a token, as given: they are
 * hidden here, whatever wrote them.
 */
export function safe(value: unknown): string {
  return safeText(String(value));
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
function link(url: string, text = url): ComponentChildren {
  return isWebUrl(url)
    ? h("a", { href: safe(url), rel: "noopener noreferrer" }, safe(text))
    : safe(text);
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

function Badge({ stage }: { stage: Stage }) {
  const { badge, label } = STAGE[stage];
  return h("span", { class: `badge badge-${badge}` }, safe(label));
}

function Logo() {
  return h(
    "svg",
    {
      width: "28",
      height: "28",
      viewBox: "0 0 32 32",
      fill: "none",
      "aria-hidden": "true",
    },
    h("circle", { cx: "16", cy: "7", r: "3", fill: "currentColor" }),
    h("ellipse", {
      cx: "16",
      cy: "19",
      rx: "5",
      ry: "2.25",
      fill: "currentColor",
    }),
    h("ellipse", {
      cx: "16",
      cy: "19",
      rx: "9",
      ry: "4.5",
      stroke: "currentColor",
      "stroke-width": "1.5",
      opacity: "0.55",
    }),
    h("ellipse", {
      cx: "16",
      cy: "19",
      rx: "14",
      ry: "7",
      stroke: "currentColor",
      "stroke-width": "1",
      opacity: "0.25",
    }),
  );
}

/** The page around a view, as HTML: Capture's head and header. */
function page(title: string, body: ComponentChildren): string {
  return `<!doctype html>\n${
    renderToString(
      h(
        "html",
        { lang: "en" },
        h(
          "head",
          null,
          h("meta", { charset: "utf-8" }),
          h("meta", {
            name: "viewport",
            content: "width=device-width, initial-scale=1",
          }),
          h("meta", { name: "color-scheme", content: "dark" }),
          h("link", {
            rel: "icon",
            type: "image/svg+xml",
            href: "/favicon.svg",
          }),
          h("link", { rel: "stylesheet", href: "/web.css" }),
          h("script", { src: "/reload.js", defer: true }),
          h("title", null, `${safe(title)} — Factory`),
        ),
        h(
          "body",
          null,
          h(
            "header",
            null,
            h(
              "a",
              { class: "brand", href: "/" },
              h(Logo, null),
              h(
                "span",
                { class: "brand-name" },
                "puddle ",
                h("span", { class: "brand-accent" }, "works"),
              ),
              h("span", { class: "brand-app" }, "Factory"),
            ),
            h("span", {
              class: "read-only",
              title: "Changes go through the draft behavior's methods",
            }, "Read-only"),
          ),
          h("main", null, body),
        ),
      ),
    )
  }\n`;
}

const ReadAt = ({ readAt }: { readAt: string }) =>
  h("p", { class: "card-meta read-at" }, "Read ", safe(formatTime(readAt)));

/** What a card says after "updated": what the app's stage is waiting on. */
function cardNote(app: App, stage: Stage): string | undefined {
  const { prefill, draft, visibility, readiness, buildResult } = app;
  switch (stage) {
    case "agree":
      return prefill && prefill.toDecide.length > 0
        ? `${plural(prefill.toDecide.length, "thing")} to decide`
        : "nothing left to decide";
    case "implement":
      return draft ? plural(draft.files.length, "file") : undefined;
    case "visibility":
      return visibility && `recommends ${visibility.recommendation}`;
    case "review":
      return readiness && plural(readiness.blockers.length, "blocker");
    case "publish":
      return buildResult?.pullRequest || readiness?.pullRequest
        ? "PR open"
        : "no pull request yet";
    case "record":
      return buildResult?.published &&
        `${buildResult.published.version}, ${buildResult.published.visibility}`;
  }
}

function Card({ app }: { app: App }) {
  const stage = stageOf(app);
  const note = cardNote(app, stage);
  return h(
    "div",
    { class: waitingOnPerson(stage) ? "card waiting" : "card" },
    h(
      "div",
      { class: "card-title" },
      h("a", { href: safe(appHref(app.name)) }, safe(app.name)),
      h(
        "div",
        { class: "card-meta" },
        "updated ",
        safe(formatTime(updatedAt(app))),
        note && ` · ${safe(note)}`,
      ),
    ),
    h(Badge, { stage }),
  );
}

const cards = (apps: App[]) =>
  apps.map((app) => h(Card, { key: app.name, app }));

/** Every app, grouped by the stage it is at. */
export function overviewPage(apps: App[], readAt: string): string {
  const waiting = apps.filter((a) => waitingOnPerson(stageOf(a))).length;
  const sections = grouped(apps).map((g) => {
    const id = `group-${g.stage}`;
    const rest = g.apps.slice(RECENT_PER_GROUP);
    return h(
      "section",
      { key: g.stage, "aria-labelledby": id },
      h("h2", { id }, safe(g.heading)),
      cards(g.apps.slice(0, RECENT_PER_GROUP)),
      rest.length > 0 && h(
        "details",
        { class: "show-all" },
        h(
          "summary",
          null,
          h("span", { class: "when-closed" }, `Show all ${g.apps.length}`),
          h("span", { class: "when-open" }, "Show fewer"),
        ),
        cards(rest),
      ),
    );
  });
  return page(
    "Apps",
    h(
      Fragment,
      null,
      h("h1", null, "Apps"),
      waiting > 0 && h(
        "p",
        { class: "waiting-note" },
        `${
          plural(waiting, "app")
        } waiting on you: each one needs your decision before it can move on.`,
      ),
      apps.length === 0
        ? h(
          "p",
          { class: "empty" },
          "No apps yet. Start one with ",
          h(
            "code",
            null,
            "swamp workflow run @puddleworks/puddleworks-factory-prefill",
          ),
          ".",
        )
        : sections,
      h(ReadAt, { readAt }),
    ),
  );
}

const NotStarted = () => h("p", { class: "empty" }, "Not started.");
const None = () => h("p", { class: "empty" }, "None.");

function Section({ id, heading, children }: {
  id: string;
  heading: string;
  children?: ComponentChildren;
}) {
  return h(
    "section",
    { "aria-labelledby": `${id}-heading` },
    h("h2", { id: `${id}-heading` }, safe(heading)),
    children,
  );
}

/** Label and value rows, leaving out a value that is undefined. */
function Facts({ rows }: { rows: Array<[string, ComponentChildren]> }) {
  return h(
    "dl",
    { class: "facts" },
    rows.filter((r) => r[1] !== undefined).map(([label, value]) =>
      h("div", { key: label }, h("dt", null, safe(label)), h("dd", null, value))
    ),
  );
}

function List({ items, class: cls }: {
  items: ComponentChildren[];
  class?: string;
}) {
  return h("ul", { class: cls }, items.map((i) => h("li", null, i)));
}

const code = (value: string) => h("code", null, safe(value));

function Problems({ intro, items }: { intro: string; items: string[] }) {
  if (items.length === 0) return null;
  return h(
    "div",
    { class: "problems" },
    h("p", null, safe(intro)),
    h(List, { items: items.map(safe) }),
  );
}

function Stages({ app }: { app: App }) {
  return h(
    Section,
    { id: "stages", heading: "Stages" },
    h(
      "ol",
      { class: "timeline" },
      timeline(app).map((s) =>
        h(
          "li",
          {
            class: s.state === "current"
              ? "current"
              : s.state === "not_started"
              ? "todo"
              : undefined,
          },
          h("div", { class: "tl-label" }, safe(s.label)),
          h(
            "div",
            { class: "tl-meta" },
            s.at ? safe(formatTime(s.at)) : "Not started",
          ),
          s.note && h("div", { class: "tl-note" }, safe(s.note)),
        )
      ),
    ),
  );
}

function Prefill({ app }: { app: App }) {
  const p = app.prefill;
  if (!p) {
    return h(Section, { id: "prefill", heading: "Prefill" }, NotStarted());
  }
  return h(
    Section,
    { id: "prefill", heading: "Prefill" },
    h(
      "p",
      { class: "card-meta" },
      "Prefilled ",
      safe(formatTime(p.prefilledAt)),
    ),
    h(Facts, {
      rows: [
        [
          "Outcome spec",
          p.source.version === undefined
            ? link(p.source.url)
            : [link(p.source.url), ` (version ${safe(p.source.version)})`],
        ],
        ["Read from", code(p.specSource)],
        ["App spec", code(p.out)],
      ],
    }),
    p.toDecide.length > 0
      ? h(Problems, { intro: "Still to decide:", items: p.toDecide })
      : h("p", null, "Nothing left to decide."),
    h(Problems, { intro: "Sort out before building:", items: p.warnings }),
  );
}

function Draft({ app }: { app: App }) {
  const d = app.draft;
  if (!d) return h(Section, { id: "draft", heading: "Draft" }, NotStarted());
  return h(
    Section,
    { id: "draft", heading: "Draft" },
    h("p", { class: "card-meta" }, "Rendered ", safe(formatTime(d.renderedAt))),
    h(Facts, {
      rows: [
        ["Type", code(d.modelType)],
        ["Entry point", code(d.entryPointRef)],
        ["Written to", code(d.targetDir)],
        ["Repository", d.repository ? link(d.repository) : undefined],
        ["Visibility", d.visibility && safe(d.visibility)],
      ],
    }),
    h("h3", null, safe(plural(d.files.length, "file"))),
    d.files.length > 0
      ? h(List, { items: d.files.map(code), class: "files" })
      : None(),
    d.overwrote.length > 0 && h(
      Fragment,
      null,
      h("h3", null, "Replaced"),
      h(List, { items: d.overwrote.map(code), class: "files" }),
    ),
  );
}

const Passed = () => h("span", { class: "badge badge-delivered" }, "Passed");
const Failed = () => h("span", { class: "badge badge-closed" }, "Failed");
const Verdict = ({ ok }: { ok: boolean }) => ok ? Passed() : Failed();

function Visibility({ app }: { app: App }) {
  const v = app.visibility;
  if (!v) {
    return h(
      Section,
      { id: "visibility", heading: "Visibility" },
      NotStarted(),
    );
  }
  return h(
    Section,
    { id: "visibility", heading: "Visibility" },
    h("p", { class: "card-meta" }, "Checked ", safe(formatTime(v.assessedAt))),
    h(
      "p",
      null,
      h(
        "span",
        {
          class: `badge ${
            v.recommendation === "public" ? "badge-active" : "badge-draft"
          }`,
        },
        "Recommends ",
        safe(v.recommendation),
      ),
      v.canBePublic
        ? " Every required check passed, so it can be public."
        : " A required check failed, so it must stay private.",
    ),
    h(Facts, {
      rows: [
        ["Manifest", safe(v.manifestVisibility ?? "not set")],
        ["Repository", safe(v.repoVisibility)],
      ],
    }),
    h("h3", null, "Checks"),
    v.checks.length > 0
      ? h(
        "dl",
        { class: "criteria checks" },
        v.checks.map((c) =>
          h(
            "div",
            null,
            h("dt", null, safe(c.id)),
            h(
              "dd",
              null,
              h(Verdict, { ok: c.ok }),
              " ",
              h("span", { class: "card-meta" }, safe(c.role)),
              ` ${safe(c.detail)}`,
            ),
          )
        ),
      )
      : None(),
    h("h3", null, "Findings"),
    v.findings.length > 0
      ? h(List, {
        items: v.findings.map((f) => [
          code(`${f.file}:${f.line}`),
          ` ${safe(f.kind)}: ${safe(findingText(f.kind, f.text))}`,
        ]),
      })
      : None(),
  );
}

function Readiness({ app }: { app: App }) {
  const r = app.readiness;
  if (!r) {
    return h(Section, { id: "readiness", heading: "Readiness" }, NotStarted());
  }
  const review = r.review
    ? h(
      Fragment,
      null,
      h(
        "p",
        null,
        code(r.review.file),
        ` reviewed ${safe(r.review.reviewedAt)}: ${
          safe(
            `${r.review.counts.pass} pass · ${r.review.counts.na} n/a · ${
              plural(r.review.counts.issue, "issue")
            } · ${r.review.counts.pending} pending`,
          )
        }`,
      ),
      r.review.issues.length > 0 && h(List, {
        items: r.review.issues.map((i) => [code(i.id), ` ${safe(i.note)}`]),
      }),
    )
    : h(
      "p",
      { class: "empty" },
      "No review found at ",
      code(r.reviewFile),
      ".",
    );
  return h(
    Section,
    { id: "readiness", heading: "Readiness" },
    h("p", { class: "card-meta" }, "Checked ", safe(formatTime(r.assessedAt))),
    h(
      "p",
      null,
      r.ready
        ? h("span", { class: "badge badge-active" }, "Ready to publish")
        : h("span", { class: "badge badge-closed" }, "Blocked"),
    ),
    h(Problems, { intro: "Before it can be published:", items: r.blockers }),
    h(Facts, {
      rows: [
        [
          "Package",
          r.package
            ? code(r.version ? `${r.package}@${r.version}` : r.package)
            : undefined,
        ],
        ["Visibility", r.visibility ? safe(r.visibility) : undefined],
        [
          "Recommended",
          r.recommendation ? safe(r.recommendation) : "not checked yet",
        ],
        ["Pull request", r.pullRequest ? link(r.pullRequest) : undefined],
        ["Commit", r.commit ? code(r.commit) : undefined],
      ],
    }),
    h("h3", null, "Review"),
    review,
    h("h3", null, "Acceptance criteria"),
    r.criteria.length > 0
      ? h(
        "dl",
        { class: "criteria" },
        r.criteria.map((c) =>
          h(
            "div",
            null,
            h("dt", null, safe(c.id)),
            h(
              "dd",
              null,
              h(Verdict, { ok: c.ok }),
              ` ${safe(c.text)}`,
              c.tests.length > 0 &&
                h(List, { items: c.tests.map(code), class: "tests" }),
              c.manual.trim() && h(
                "span",
                { class: "card-meta" },
                `Checked by hand: ${safe(c.manual)}`,
              ),
            ),
          )
        ),
      )
      : None(),
    h("h3", null, "Summary"),
    h("pre", { class: "summary" }, safe(r.summary)),
  );
}

function BuildResult({ app }: { app: App }) {
  const b = app.buildResult;
  if (!b) {
    return h(
      Section,
      { id: "build-result", heading: "Build result" },
      NotStarted(),
    );
  }
  return h(
    Section,
    { id: "build-result", heading: "Build result" },
    h("p", { class: "card-meta" }, "Recorded ", safe(formatTime(b.builtAt))),
    h(Facts, {
      rows: [
        ["Repository", link(b.repository)],
        ["Pull request", b.pullRequest ? link(b.pullRequest) : "None yet"],
        ["Build ref", code(b.buildRef)],
        ["Extension", code(b.extension)],
        ["Entry point", code(b.entryPointRef)],
        [
          "Package",
          b.published
            ? [
              link(registryUrl(b.extension), b.extension),
              ` ${safe(`${b.published.version}, ${b.published.visibility}`)}`,
            ]
            : "Not published yet",
        ],
        ["Agreed at", b.source ? link(b.source.url) : undefined],
      ],
    }),
  );
}

/** One app: where it is, then each of its records in Factory order. */
export function appPage(app: App, readAt: string): string {
  const repository = app.buildResult?.repository ?? app.draft?.repository;
  return page(
    app.name,
    h(
      Fragment,
      null,
      h("a", { class: "back-link", href: "/" }, "All apps"),
      h(
        "div",
        { class: "show-header" },
        h("h1", null, safe(app.name)),
        h(
          "div",
          { class: "show-meta" },
          h(Badge, { stage: stageOf(app) }),
          h("span", null, "Updated ", safe(formatTime(updatedAt(app)))),
          repository && h("span", null, link(repository)),
        ),
      ),
      h(Stages, { app }),
      h(Prefill, { app }),
      h(Draft, { app }),
      h(Visibility, { app }),
      h(Readiness, { app }),
      h(BuildResult, { app }),
      h(ReadAt, { readAt }),
    ),
  );
}

/** A page the viewer doesn't have, or an app it has no records for. */
export function notFoundPage(): string {
  return page(
    "Not found",
    h(
      Fragment,
      null,
      h("h1", null, "Not found"),
      h(
        "p",
        null,
        "There is no such page. ",
        h("a", { href: "/" }, "See every app"),
        ".",
      ),
    ),
  );
}
