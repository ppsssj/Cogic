/**
 * Solid edge strokes while the user drags the canvas (P15-P1).
 *
 * P15-P0 measured that the long frames of a real pan are GPU-process raster of edges that
 * virtualization mounts as they enter the view, and that dashed strokes cost about twice as much
 * to raster as solid ones. While a drag is in progress, edges are drawn solid; their dashes come
 * back when it ends. Zoom (wheel, buttons) and programmatic viewport moves do not switch.
 *
 * Opt-in through the hidden setting `cogic.experimental.panSolidEdges`:
 * - off (default): no change;
 * - immediate: dashes come back as soon as the drag ends;
 * - delayed: dashes come back PAN_SOLID_RESTORE_DELAY_MS after the drag ends, and a new drag within
 *   that time keeps the edges solid.
 *
 * (P15-P1 also measured making only the edges that enter during the drag solid. It did not reduce the
 * long frames, so it is not offered.)
 */
export type PanEdgeDetailPolicy = "off" | "immediate" | "delayed";

export const PAN_EDGE_DETAIL_SETTING = "experimental.panSolidEdges";
export const PAN_SOLID_RESTORE_DELAY_MS = 150;

const POLICIES: readonly PanEdgeDetailPolicy[] = ["off", "immediate", "delayed"];

export function parsePanEdgeDetailPolicy(value: unknown): PanEdgeDetailPolicy {
  return POLICIES.includes(value as PanEdgeDetailPolicy) ? (value as PanEdgeDetailPolicy) : "off";
}

/**
 * Whether a d3-zoom event's source event is a pointer drag moving the view. Wheel zoom has a
 * `wheel` source; programmatic moves (fit, focus, trace, runtime) have none.
 */
export function isDragMoveSource(source: { type?: unknown } | null | undefined): boolean {
  const type = source?.type;
  return type === "mousemove" || type === "pointermove" || type === "touchmove";
}

/**
 * The switch itself, without the DOM: `apply(true)` draws edges solid, `apply(false)` puts the
 * dashes back. It changes nothing per frame once a drag is solid.
 */
export function createPanSolidController(options: {
  policy: PanEdgeDetailPolicy;
  apply: (solid: boolean) => void;
  schedule: (fn: () => void, ms: number) => unknown;
  cancelSchedule: (handle: unknown) => void;
}) {
  const { policy, apply, schedule, cancelSchedule } = options;
  let solid = false;
  let pending: unknown = null;
  const clearPending = () => {
    if (pending !== null) {
      cancelSchedule(pending);
      pending = null;
    }
  };
  const restore = () => {
    clearPending();
    if (solid) {
      solid = false;
      apply(false);
    }
  };
  return {
    get solid() {
      return solid;
    },
    /** A d3-zoom `zoom` event, with its source event. */
    move(source: { type?: unknown } | null | undefined) {
      if (policy === "off" || !isDragMoveSource(source)) {
        return;
      }
      clearPending();
      if (!solid) {
        solid = true;
        apply(true);
      }
    },
    /** A d3-zoom `end` event. */
    end() {
      if (!solid) {
        clearPending();
        return;
      }
      if (policy === "delayed") {
        clearPending();
        pending = schedule(() => {
          pending = null;
          restore();
        }, PAN_SOLID_RESTORE_DELAY_MS);
        return;
      }
      restore();
    },
    /** Window blur, pointer cancel, export, unmount: dashes back now. */
    cancel: restore,
  };
}
