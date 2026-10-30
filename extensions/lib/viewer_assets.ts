/**
 * The viewer's files, served beside the pages: Capture's stylesheet, with
 * only the rules these pages use and a few of the Factory's own, Capture's
 * favicon, and the one script, which reloads the page when the data changes.
 * There is no build step.
 *
 * @module
 */

/** One file of the page. */
export interface ViewerAsset {
  type: string;
  text: string;
}

const WEB_CSS =
  `/* Capture's web.css: the palette mirrors puddleworks_website/src/index.css. */

:root {
  --color-bg: #0f1219;
  --color-bg-secondary: #161b26;
  --color-bg-card: #1c2233;
  --color-text: #e8ecf1;
  --color-text-secondary: #8b95a8;
  --color-text-tertiary: #5a6478;
  --color-accent: #5ec4d4;
  --color-accent-muted: #3a8a96;
  --color-accent-glow: rgba(94, 196, 212, 0.08);
  --color-border: rgba(255, 255, 255, 0.06);
  --color-border-hover: rgba(255, 255, 255, 0.12);

  --color-success: #6ee7b7;
  --color-warning: #fcd34d;
  --color-danger: #fca5a5;
}

html {
  color-scheme: dark;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
    Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: var(--color-accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}

/* Header */

header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(15, 18, 25, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border);
  padding: 0 24px;
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
}

header .brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent);
}

header .brand:hover {
  text-decoration: none;
}

header .brand-name {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--color-text);
}

header .brand-accent {
  color: var(--color-accent);
}

header .brand-app {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  border-left: 1px solid var(--color-border-hover);
  padding-left: 10px;
  margin-left: 2px;
}

header .read-only {
  font-size: 12px;
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border-hover);
  border-radius: 12px;
  padding: 2px 10px;
}

main {
  max-width: 860px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}

h1 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: 24px;
  overflow-wrap: anywhere;
}

h2 {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  margin: 32px 0 12px;
}

h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin: 16px 0 6px;
}

/* Prose */

main p {
  font-size: 14px;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
  line-height: 1.6;
}

main ul {
  padding-left: 20px;
  font-size: 14px;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

main ul li {
  margin-bottom: 4px;
}

.empty {
  color: var(--color-text-tertiary);
  font-style: italic;
  font-size: 13px;
  padding: 8px 0;
}

/* Cards and badges */

.card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  margin-bottom: 8px;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: border-color .15s;
}

.card:hover {
  border-color: var(--color-border-hover);
}

.card .card-title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.card .card-title a {
  color: var(--color-text);
}

.card .card-title a:hover {
  color: var(--color-accent);
  text-decoration: none;
}

.card-meta {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 400;
}

main p.card-meta {
  font-size: 12px;
  margin-bottom: 8px;
}

.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.badge-active {
  background: rgba(94, 196, 212, 0.12);
  color: var(--color-accent);
  border-color: rgba(94, 196, 212, 0.25);
}

.badge-draft {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
  border-color: var(--color-border-hover);
}

.badge-delivered {
  background: rgba(110, 231, 183, 0.12);
  color: var(--color-success);
  border-color: rgba(110, 231, 183, 0.25);
}

.badge-review {
  background: rgba(252, 211, 77, 0.12);
  color: var(--color-warning);
  border-color: rgba(252, 211, 77, 0.25);
}

.badge-closed {
  background: rgba(252, 165, 165, 0.12);
  color: var(--color-danger);
  border-color: rgba(252, 165, 165, 0.25);
}

/* App page */

.back-link {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 20px;
  display: inline-block;
}

.back-link:hover {
  color: var(--color-accent);
}

.back-link::before {
  content: "← ";
}

.show-header {
  margin-bottom: 28px;
}

.show-header h1 {
  margin-bottom: 6px;
}

.show-meta {
  font-size: 13px;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px 20px;
  flex-wrap: wrap;
}

/* Timeline */

.timeline {
  list-style: none;
  position: relative;
  padding-left: 24px;
}

.timeline::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--color-border-hover);
}

.timeline li {
  position: relative;
  margin-bottom: 20px;
}

.timeline li::before {
  content: "";
  position: absolute;
  left: -20px;
  top: 5px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  border: 2px solid var(--color-bg);
  box-shadow: 0 0 0 2px var(--color-text-tertiary);
}

.timeline li.current::before {
  background: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent), 0 0 0 6px var(--color-accent-glow);
}

.timeline .tl-label {
  font-weight: 500;
  font-size: 14px;
}

.timeline .tl-meta {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 2px;
}

.timeline .tl-note {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-top: 4px;
  white-space: pre-wrap;
  border-left: 2px solid var(--color-border-hover);
  padding-left: 10px;
}

.problems {
  background: rgba(252, 211, 77, 0.08);
  border: 1px solid rgba(252, 211, 77, 0.25);
  border-radius: 8px;
  padding: 10px 14px;
  margin: 10px 0;
  font-size: 13px;
  color: var(--color-warning);
}

main .problems ul,
main .problems p {
  color: var(--color-warning);
  margin-bottom: 0;
}

.criteria {
  margin-bottom: 16px;
}

.criteria > div {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border);
}

.criteria > div:last-child {
  border-bottom: none;
}

.criteria dt {
  flex: none;
  width: 48px;
  padding-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--color-accent);
}

.criteria dd {
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

main .read-at {
  margin-top: 32px;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

code {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 1px 5px;
}

/* Factory: apps waiting on a person, as Capture marks an open question. */
.card.waiting {
  border-color: rgba(252, 211, 77, 0.35);
  border-left: 3px solid var(--color-warning);
}
main p.waiting-note {
  font-size: 13px;
  color: var(--color-warning);
  margin: -12px 0 8px;
}

/* Factory: a group's older apps, rolled up under "Show all". */
details.show-all > summary {
  list-style: none;
  display: inline-block;
  margin: 4px 0 8px;
  font-size: 13px;
  color: var(--color-accent);
  cursor: pointer;
}
details.show-all > summary::-webkit-details-marker {
  display: none;
}
details.show-all > summary:hover {
  text-decoration: underline;
}
details.show-all .when-open,
details.show-all[open] .when-closed {
  display: none;
}
details.show-all[open] .when-open {
  display: inline;
}

/* Factory: a stage not started yet. */
.timeline li.todo .tl-label,
.timeline li.todo .tl-meta {
  color: var(--color-text-tertiary);
}

/* Factory: label and value rows, and the checks' longer ids. */
.facts {
  margin-bottom: 16px;
}
.facts > div {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border);
}
.facts > div:last-child {
  border-bottom: none;
}
.facts dt {
  flex: none;
  width: 110px;
  color: var(--color-text-tertiary);
}
.facts dd {
  min-width: 0;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}
.criteria.checks dt {
  width: 140px;
  overflow-wrap: anywhere;
}
.criteria dd .badge {
  margin-right: 6px;
}
main ul.files,
main ul.tests {
  list-style: none;
  padding-left: 0;
}
main ul.tests {
  margin: 6px 0 0;
}

/* Factory: the readiness summary, one screen of plain text. */
pre.summary {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 600px) {
  header {
    padding: 10px 16px;
  }
  main {
    padding: 28px 16px 48px;
  }
  .card {
    flex-wrap: wrap;
  }
}
`;

const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"
  color="#5ec4d4">
  <circle cx="16" cy="7" r="3" fill="currentColor" />
  <ellipse cx="16" cy="19" rx="5" ry="2.25" fill="currentColor" />
  <ellipse cx="16" cy="19" rx="9" ry="4.5" stroke="currentColor"
    stroke-width="1.5" opacity="0.55" />
  <ellipse cx="16" cy="19" rx="14" ry="7" stroke="currentColor" stroke-width="1"
    opacity="0.25" />
</svg>
`;

// The event stream carries no data, only that something changed.
const RELOAD_JS =
  `new EventSource("/events").onmessage = () => location.reload();
`;

/** The page's files by served name. */
export const VIEWER_ASSETS: Readonly<Record<string, ViewerAsset>> = {
  "web.css": { type: "text/css; charset=utf-8", text: WEB_CSS },
  "favicon.svg": { type: "image/svg+xml", text: FAVICON_SVG },
  "reload.js": { type: "text/javascript; charset=utf-8", text: RELOAD_JS },
};
