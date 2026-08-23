# Agent Note: TUI subcell whale banner

Status: implemented

English | [中文](2026-08-23-tui-subcell-whale-banner.zh.md)

## Problem

The first-load TUI banner did not reproduce the reference DeepSeek whale. A compressed 45-by-13 conversion used partial Braille cells for curves, which terminals correctly rasterized as separate dots instead of filled blue pixels. The renderer also centered each right-trimmed row independently, moving the tail, mouth, and belly horizontally relative to one another. Its six-row block title differed from the compact wordmark in the same reference.

## Decision

The whale is one immutable 52-by-19 terminal-cell canvas reconstructed from the reference at its original cell grid. `█` paints a complete cell and `▀` or `▄` paints one vertical half; Braille cells are excluded because their unpainted space is visible at this scale. One shared left offset centers the complete canvas, while the literal's leading spaces preserve every row's coordinates.

The final whale row uses upper-half blocks, leaving its lower half empty before a single spaced `D E E P S E E K  H A R N E S S` row in the same `#4D6BFE` brand color. No image file, decoder, rasterizer, per-cell React node, animation timer, platform branch, or terminal capability probe enters startup or repaint. The adaptive fallback, transcript layout, and header glyph remain unchanged.

## Alternatives considered

### Why not render a bitmap through Kitty, iTerm2, or Sixel?

Those protocols require terminal-specific capability handling and substantially increase startup, teardown, and fallback behavior for a decorative first-load surface.

### Why not keep Braille for curved edges?

Braille represents up to eight isolated dots inside a terminal cell. That is useful for plots and thin contours, but a partial Braille edge beside a full block produces the perforated outline visible in the failed banner rather than the reference's solid pixel edge.

### Why not center each visible row by its measured width?

Right-trimmed rows have different measured widths even though their leading spaces belong to one 52-cell coordinate system. Per-row centering deforms the drawing; only the full canvas has a center.

## Consequences

The whale occupies 52 columns and 19 rows, followed by one wordmark row. Terminals render block stroke edges differently, but `█`, `▀`, and `▄` remain one display cell and preserve geometry across the supported width model. A 19-row viewport may show the whale without the wordmark; narrower or shorter viewports use the plain welcome card.

## Testing

`welcome-banner.spec.ts` pins the 52-by-19 literal, identifying features, block-only glyph allowlist, one-cell display widths, fixed-canvas centering, compact wordmark, and fallback behavior. `render-frame.spec.ts` verifies that the assembled Ink fullscreen frame contains the silhouette and wordmark without changing frame or cursor geometry.
