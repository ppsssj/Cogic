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
 * - safe: P15-R2 measured that even the one highlighted relation of focused costs 56-152 ms frames
 *   when its path is long, for as long as it stays highlighted. Safe keeps focused's highlight
 *   (color, width, arrow, label) but no dash moves at all.
 * - safe-marker: an experiment on top of safe (P15-R3). The highlighted relation stays static and
 *   one small marker moves along it, as a compositor-only transform animation.
 *
 * Further reasons to animate (hover, for example) would be extra inputs here.
 *
 * The default is safe (P15-RC): with no setting, or a value that is not one of the four names,
 * no dash moves. legacy stays available by name for anyone who wants the moving dashes back.
 */
export type DataflowMotionPolicy = "legacy" | "focused" | "safe" | "safe-marker";

const POLICIES: readonly DataflowMotionPolicy[] = ["legacy", "focused", "safe", "safe-marker"];

export const DATAFLOW_MOTION_SETTING = "experimental.dataflowMotion";

/** What applies with no setting, an invalid one, and before the extension has said anything. */
export const DEFAULT_DATAFLOW_MOTION_POLICY: DataflowMotionPolicy = "safe";

export function parseDataflowMotionPolicy(value: unknown): DataflowMotionPolicy {
  return POLICIES.includes(value as DataflowMotionPolicy) ? (value as DataflowMotionPolicy) : DEFAULT_DATAFLOW_MOTION_POLICY;
}

export type DataflowMotionInput = {
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
};

const eligible = (input: DataflowMotionInput) =>
  input.isDataflow && !input.muted && !input.collapsedBridge && !input.focusContext;

/** Whether the edge's dashes move (React Flow's `animated`). */
export function shouldAnimateDataflow(input: DataflowMotionInput): boolean {
  if (!eligible(input)) {
    return false;
  }
  switch (input.policy) {
    case "legacy":
      return true;
    case "focused":
      return input.explicitlyHighlighted;
    default:
      return false;
  }
}

/** Whether the edge carries the moving marker of safe-marker; at most the highlighted one does. */
export function shouldShowFlowMarker(input: DataflowMotionInput): boolean {
  return input.policy === "safe-marker" && eligible(input) && input.explicitlyHighlighted;
}
