// Dashed strokes on very long edges are expensive to rasterize when zoomed out.
// Zoom 0.1 is the measured case (P12-E9); 0.2 is a conservative policy value, not a tuned optimum.
export const LOW_DETAIL_ENTER_ZOOM = 0.2;
export const LOW_DETAIL_EXIT_ZOOM = 0.25;

/** Hysteresis keeps the mode from flipping while the zoom hovers around one threshold. */
export function nextLowDetailEdges(current: boolean, zoom: number): boolean {
  return current ? zoom < LOW_DETAIL_EXIT_ZOOM : zoom <= LOW_DETAIL_ENTER_ZOOM;
}
