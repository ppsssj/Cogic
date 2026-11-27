/**
 * Which dataflow edges move. P15-Z0A measured that the dash animation of dataflow edges costs a
 * continuous repaint that scales with the animated dashed edges in view, while static dashes and
 * the graph itself do not.
 *
 * - legacy: as before. Every dataflow edge that is not muted animates: all of them with nothing
 *   selected; with a node selected, the ones touching it.
 * - focused: only relations the user highlighted explicitly animate (a Param Flow chosen in the
 *   Inspector, an aggregate member opened, or the trace's current flow). Every other dataflow edge
 *   keeps its dashes, color and arrow, without motion.
 *
 * Further reasons to animate (hover, for example) would be extra inputs here.
 */
export type DataflowMotionPolicy = "legacy" | "focused";

export const DATAFLOW_MOTION_SETTING = "experimental.dataflowMotion";

export function parseDataflowMotionPolicy(value: unknown): DataflowMotionPolicy {
  return value === "focused" ? "focused" : "legacy";
}

export function shouldAnimateDataflow(input: {
  policy: DataflowMotionPolicy;
  isDataflow: boolean;
  /** Dimmed by another highlight or selection. */
  muted: boolean;
  /** Drawn to a collapsed group; never animated. */
  collapsedBridge: boolean;
  /** Dimmed by Focus + Context. */
  focusContext: boolean;
  /** The edge holds the relation the user highlighted (highlightedEdgeId). */
  explicitlyHighlighted: boolean;
}): boolean {
  const eligible = input.isDataflow && !input.muted && !input.collapsedBridge && !input.focusContext;
  if (!eligible) {
    return false;
  }
  return input.policy === "legacy" ? true : input.explicitlyHighlighted;
}
