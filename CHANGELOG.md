# Change Log

All notable changes to the "cogic" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

Not yet released to the Marketplace; the published 0.0.5 build may differ from this code.

- Preserve graph exploration during runtime debugging: debug sessions no longer replace the exploration graph, the start node, selection, and Root are kept while paused, frames outside the current root can be expanded explicitly, and setting a folder Root from the graph keeps the root.
- Avoid TypeScript `SourceFile` cache thrash on large workspaces: the cache capacity follows the analyzed program size (bounded by entry and source-text budgets) instead of a fixed 800-entry LRU, so active-file edits on 1,000+ file workspaces reuse cached files.

## [0.0.5] - 2026-05-24

- Add analysis cache controls for repeated graph analysis and TypeScript SourceFile parsing.
- Refresh icon button styling with borderless controls, subtle hover scaling, and improved SVG alignment.
- Rewrite the README to reflect current Cogic features and Marketplace documentation.

## [0.0.4] - 2026-05-04

- Fix packaged extension missing TypeScript default library definitions.

## [0.0.3] - 2026-04-07

- Add GitHub and VS Marketplace links to the README.
- Add SVG graph export and improve full-graph JPG/SVG snapshot capture.

## [0.0.2] - 2026-04-05

- Fix Runtime Debug demo image rendering on Marketplace README.

## [0.0.1] - 2026-04-05

- Initial release
