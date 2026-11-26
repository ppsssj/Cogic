import { useCallback, useEffect, useRef, type FocusEvent, type RefObject } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useStoreApi,
  type EdgeProps,
} from "reactflow";
import type { GraphEdgeKind } from "../../../src/shared/protocol";
import type { EdgeMember } from "../../../src/shared/edgeAggregation";
import { countRender } from "../lib/semanticZoomExperiment";

/** What the canvas hands to the Inspector when an aggregated edge is selected. */
export type AggregateSelection = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  members: EdgeMember[];
};

export type AggregateEdgeData = AggregateSelection & {
  sourceName: string;
  targetName: string;
  selected: boolean;
  muted?: boolean;
  /**
   * Set while Focus is on: the members with the focus center at one end. The badge still
   * counts and opens every member.
   */
  focusRelatedIds?: string[];
  /** Label of the focused member, when one is focused. */
  focusedLabel?: string;
  onSelect: (selection: AggregateSelection) => void;
};

// Selecting updates the nodes, and React Flow then unmounts and remounts the edges. A badge
// activated from the keyboard takes its focus back when it returns within this time.
const FOCUS_RETURN_MS = 1000;
let keyboardActivation: { id: string; at: number } | null = null;

/** The only clickable part of an edge; the line itself never takes pointer events. */
export function AggregateBadge({
  data,
  x,
  y,
  offsetY = 0,
}: {
  data: AggregateEdgeData;
  x: number;
  y: number;
  /** Extra shift in badge pixels, so stacked badges stay apart at any zoom. */
  offsetY?: number;
}) {
  const { setCenter, getZoom } = useReactFlow();
  const { id, kind, source, target, members, onSelect } = data;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const focusRelated = data.focusRelatedIds?.length;
  const focusText =
    focusRelated === undefined ? "" : ` ${focusRelated} of ${members.length} touch the focus.`;

  useEffect(() => {
    if (keyboardActivation?.id !== id) return;
    if (performance.now() - keyboardActivation.at > FOCUS_RETURN_MS) return;
    // Never take focus from something the user moved to.
    if (document.activeElement !== document.body) return;
    buttonRef.current?.focus({ preventScroll: true });
  }, [id]);

  // Focusing an element outside the view makes the browser scroll the clipped canvas
  // sideways. Undo that and move the viewport instead.
  const handleFocus = useCallback(
    (event: FocusEvent<HTMLButtonElement>) => {
      const badge = event.currentTarget;
      const canvas = badge.closest(".canvas");
      for (let el = badge.parentElement; el; el = el.parentElement) {
        if (el.scrollLeft) el.scrollLeft = 0;
        if (el.scrollTop) el.scrollTop = 0;
        if (el === canvas) break;
      }
      // A mouse press must not move the view, or the click would miss its target.
      if (!canvas || !badge.matches(":focus-visible")) return;
      const pane = canvas.getBoundingClientRect();
      const rect = badge.getBoundingClientRect();
      const visible =
        rect.left >= pane.left &&
        rect.right <= pane.right &&
        rect.top >= pane.top &&
        rect.bottom <= pane.bottom;
      if (!visible) setCenter(x, y, { zoom: getZoom() });
    },
    [getZoom, setCenter, x, y],
  );

  return (
    <EdgeLabelRenderer>
      <button
        ref={buttonRef}
        type="button"
        // No "nopan": dragging from a badge still pans, and only a click without movement
        // selects. "nokey": React Flow must not swallow Space, which activates the button.
        className={[
          "cgAggregateBadge",
          `cgAggregateBadge--${kind}`,
          data.selected ? "cgAggregateBadge--selected" : "",
          focusRelated === undefined
            ? ""
            : focusRelated > 0
              ? "cgAggregateBadge--focusRelated"
              : "cgAggregateBadge--focusContext",
          "nokey",
        ].join(" ")}
        style={{
          // Screen-size badge: the scale cancels the viewport zoom when zoomed out.
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(var(--cg-badge-scale, 1)) translateY(${offsetY}px)`,
          opacity: data.muted && !data.selected ? 0.45 : 1,
        }}
        data-count={members.length}
        data-focus-related={focusRelated}
        aria-pressed={data.selected}
        aria-label={`${kind}: ${members.length} relations from ${data.sourceName} to ${data.targetName}.${focusText} Show in Inspector.`}
        title={`${data.sourceName} -> ${data.targetName}${focusText ? `
${focusText.trim()}` : ""}`}
        onFocus={handleFocus}
        onClick={(event) => {
          event.stopPropagation();
          // A click without a pointer (detail 0) came from Enter or Space.
          keyboardActivation = event.detail === 0 ? { id, at: performance.now() } : null;
          onSelect({ id, kind, source, target, members });
        }}
      >
        <span className="cgAggregateBadgeKind">
          {data.focusedLabel ? `${data.focusedLabel} · ` : ""}
          {kind}{" "}
        </span>
        ×{members.length}
        {focusRelated ? (
          <span className="cgAggregateBadgeFocus" aria-hidden="true">
            {" "}
            · {focusRelated} in focus
          </span>
        ) : null}
      </button>
    </EdgeLabelRenderer>
  );
}

/** Same path as the default edge, plus the badge. */
export function AggregateEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<{ aggregate?: AggregateEdgeData }>) {
  countRender("customEdge");
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data?.aggregate ? <AggregateBadge data={data.aggregate} x={labelX} y={labelY} /> : null}
    </>
  );
}

const DECLUTTER_DELAY_MS = 150;
const COVERED = "data-covered";

type Box = { left: number; right: number; top: number; bottom: number };

function overlaps(a: Box, b: Box) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Hides badges that would cover a group toggle or a badge with more relations. Hidden badges
 * take no pointer events but stay in the Tab order and show while focused or selected.
 */
function declutterBadges(container: HTMLElement) {
  const taken: Box[] = [
    ...container.querySelectorAll(".cgGroupHeader, .cgFolderHeader"),
  ].map((el) => el.getBoundingClientRect());
  const badges = [...container.querySelectorAll<HTMLElement>(".cgAggregateBadge")].map((el) => ({
    el,
    box: el.getBoundingClientRect(),
    selected: el.getAttribute("aria-pressed") === "true",
    count: Number(el.dataset.count ?? 0),
  }));
  badges.sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count);

  // Read everything first, then write.
  const covered = badges.map(({ box, selected }) => {
    if (!selected && taken.some((other) => overlaps(box, other))) return true;
    taken.push(box);
    return false;
  });
  badges.forEach(({ el }, index) => el.toggleAttribute(COVERED, covered[index]));
}

/**
 * Keeps badges readable when zoomed out. Writes one CSS variable on the label layer when the
 * zoom changes, and declutters after the view settles. No React state is involved.
 */
export function AggregateBadgeScale({
  containerRef,
  suspended,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  suspended: boolean;
}) {
  const store = useStoreApi();
  const lastZoom = useRef<number | null>(null);

  useEffect(() => {
    // Export draws the graph at zoom 1.
    if (suspended) return;
    const container = containerRef.current;
    let layer: HTMLElement | null = null;
    let timer = 0;
    // Trailing, so nothing is measured while the user pans or zooms.
    const scheduleDeclutter = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (container) declutterBadges(container);
      }, DECLUTTER_DELAY_MS);
    };
    const observer = new MutationObserver(scheduleDeclutter);
    const apply = (zoom: number) => {
      if (zoom === lastZoom.current && layer?.isConnected) return;
      if (!layer?.isConnected) {
        layer = container?.querySelector<HTMLElement>(".react-flow__edgelabel-renderer") ?? null;
        observer.disconnect();
        if (layer) observer.observe(layer, { childList: true });
      }
      if (!layer) return;
      lastZoom.current = zoom;
      layer.style.setProperty("--cg-badge-scale", String(Math.max(1, 1 / zoom)));
      scheduleDeclutter();
    };

    apply(store.getState().transform[2]);
    const unsubscribe = store.subscribe((state) => apply(state.transform[2]));
    return () => {
      unsubscribe();
      observer.disconnect();
      window.clearTimeout(timer);
      container
        ?.querySelectorAll(`[${COVERED}]`)
        .forEach((el) => el.removeAttribute(COVERED));
      lastZoom.current = null;
      layer?.style.removeProperty("--cg-badge-scale");
    };
  }, [containerRef, store, suspended]);

  return null;
}
