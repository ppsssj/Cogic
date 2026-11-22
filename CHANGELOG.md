# Change Log

All notable changes to the "cogic" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.0.6] - 2026-11-22

- Preserve graph exploration during runtime debugging: a debug session no longer replaces the exploration graph, and the start node, selection, and graph state are kept while paused and restored after debugging stops.
- Improve Root and Runtime Debug integration: frames are mapped to graph nodes under file and folder Roots, a frame outside the current Root is shown with an explicit "Expand frame file" action instead of rebuilding the graph, and setting a folder Root from the graph keeps the Root.
- Improve the TypeScript `SourceFile` cache policy for large workspaces: cache capacity follows the analyzed program size (bounded by entry and source-text budgets) instead of a fixed 800-entry LRU.
- Mitigate the analysis slowdown when a workspace exceeded the previous cache capacity: active-file edits on 1,000+ file workspaces now reuse cached files instead of re-parsing them.

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
