// Dashed strokes on very long edges are expensive to rasterize when zoomed out.
// Zoom 0.1 is the measured case (P12-E9); 0.2 is a conservative policy value, not a tuned optimum.
export const LOW_DETAIL_ENTER_ZOOM = 0.2;
export const LOW_DETAIL_EXIT_ZOOM = 0.25;

/** Hysteresis keeps the mode from flipping while the zoom hovers around one threshold. */
export function nextLowDetailEdges(current: boolean, zoom: number): boolean {
  return current ? zoom < LOW_DETAIL_EXIT_ZOOM : zoom <= LOW_DETAIL_ENTER_ZOOM;
}

/**
 * The current low-detail mode and its hysteresis, kept outside the DOM class so that pausing the
 * class (export draws the original strokes) does not reset it. One per canvas mount.
 */
export function createLowDetailMode(initial = false) {
  let low = initial;
  return {
    get low() {
      return low;
    },
    /** Applies a zoom; returns the new mode when it changes, otherwise null. */
    update(zoom: number): boolean | null {
      const next = nextLowDetailEdges(low, zoom);
      if (next === low) {
        return null;
      }
      low = next;
      return next;
    },
  };
}
