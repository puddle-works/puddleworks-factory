# ADR-003: A web UI is Preact rendered on the server

## Status: Accepted

Decided by Mark Ellens on 2026-11-09: "Everything should be on react / preact
and not rails". Capture records the same decision in its own ADR, "A web UI is
Preact rendered on the server".

## Context

The three apps' pages were built three ways. Capture renders its page on the
server with Preact. Factory's viewer built its HTML from template strings.
Distribution's run form is a Rails app.

A swamp extension can only ship `.ts`, `.json`, `.md`, `.yaml`, `.yml` and
`.txt` files. swamp's `ALLOWED_EXTENSIONS`, in
`src/domain/extensions/extension_safety_analyzer.ts`, checks this on both
`extension push` and `extension pull`, so a `.tsx` file is refused and JSX is
out.

## Decision

A web UI is Preact rendered on the server, written with `h()` in `.ts`, because
the swamp registry rejects `.tsx`.

- In Factory this is the viewer (`extensions/lib/viewer_html.ts`). Its
  components call `h()`, and `preact-render-to-string` turns them into the HTML
  it serves.
- `preact` and `preact-render-to-string` are pinned in `deno.json` and
  `deno.lock`, so swamp's bundler inlines those versions.
- The patterns are copied from Capture's page, not imported from it, as
  [ADR-001](ADR-001-three-separate-apps.md) requires.
- The CLAUDE.md section Factory drafts into each app says the same sentence, so
  an app that grows a page is built the same way.

## Consequences

- Without JSX, components are nested `h()` calls, which are longer to read than
  the markup.
- Preact escapes every value it renders, so the pages no longer need their own
  HTML escaping. Values from swamp data still go through `safeText`, so secrets
  in older records stay hidden.
- The viewer's routes, CSP, assets and page DOM did not change, and it has no
  build step.
- Moving Distribution's Rails run form is Distribution's own change.
