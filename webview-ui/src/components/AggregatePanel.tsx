import { useEffect, useMemo, useRef, useState } from "react";
import type { EdgeMember } from "../../../src/shared/edgeAggregation";
import type { GraphNode, GraphPayload } from "../../../src/shared/protocol";
import type { AggregateSelection } from "./AggregateEdge";

const PAGE_SIZE = 20;

export type AggregateMemberEnd = "source" | "target";

function shortPath(file: string) {
  return file.replace(/\\/g, "/").split("/").slice(-3).join("/");
}

/** Drawn endpoint: a collapsed folder or file, or a single node. */
function endpointText(id: string, node: GraphNode | undefined) {
  if (id.startsWith("folder:")) return { kind: "folder", name: shortPath(id.slice("folder:".length)) };
  if (id.startsWith("file:") || node?.kind === "file") {
    return { kind: "file", name: shortPath(node?.file ?? id.replace(/^file:/, "").replace(/:\d+$/, "")) };
  }
  return { kind: node?.kind ?? "node", name: node ? `${node.name} (${shortPath(node.file)})` : id };
}

/** Remount with `key={selection.id}` to reset paging. */
export function AggregatePanel({
  selection,
  graph,
  activeEdgeId,
  onOpenMember,
  onClose,
}: {
  selection: AggregateSelection;
  graph: GraphPayload | undefined;
  activeEdgeId: string | null;
  onOpenMember: (member: EdgeMember, end: AggregateMemberEnd) => void;
  onClose: () => void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node])),
    [graph],
  );
  const from = endpointText(selection.source, nodeById.get(selection.source));
  const to = endpointText(selection.target, nodeById.get(selection.target));
  const remaining = selection.members.length - limit;

  // Bring the panel into view without scrolling any other ancestor.
  useEffect(() => {
    rootRef.current?.closest(".inspectorBody")?.scrollTo({ left: 0, top: 0 });
  }, [selection.id]);

  return (
    <div className="panel panel--aggregate" ref={rootRef} role="region" aria-label="Aggregated relations">
      <div className="panelHeader">
        <span className="panelHeaderTitleText">AGGREGATED RELATIONS</span>
        <button className="smallBtn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="panelBody">
        <div className="kvList">
          <div className="kvRow">
            <div className="kvKey mono">relation</div>
            <div className="kvVal mono">{`${selection.kind} ×${selection.members.length}`}</div>
          </div>
          <div className="kvRow">
            <div className="kvKey mono">from {from.kind}</div>
            <div className="kvVal mono">{from.name}</div>
          </div>
          <div className="kvRow">
            <div className="kvKey mono">to {to.kind}</div>
            <div className="kvVal mono">{to.name}</div>
          </div>
        </div>
        <ul className="aggregateList" aria-label="Original relations">
          {selection.members.slice(0, limit).map((member) => (
            <li
              key={member.id}
              data-edge-id={member.id}
              className={[
                "aggregateItem",
                member.id === activeEdgeId ? "aggregateItem--active" : "",
              ].join(" ")}
            >
              <div className="aggregateEnds">
                <EndButton
                  end="source"
                  id={member.source}
                  node={nodeById.get(member.source)}
                  onOpen={() => onOpenMember(member, "source")}
                />
                <span aria-hidden="true">{"->"}</span>
                <EndButton
                  end="target"
                  id={member.target}
                  node={nodeById.get(member.target)}
                  onOpen={() => onOpenMember(member, "target")}
                />
              </div>
              {member.label ? <div className="mono aggregateLabel">{member.label}</div> : null}
              <div className="mutedText mono aggregateId" title={member.id}>
                {member.id}
              </div>
            </li>
          ))}
        </ul>
        {remaining > 0 ? (
          <button
            className="smallBtn"
            type="button"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            {`Show ${Math.min(PAGE_SIZE, remaining)} more (${remaining} left)`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EndButton({
  end,
  id,
  node,
  onOpen,
}: {
  end: AggregateMemberEnd;
  id: string;
  node: GraphNode | undefined;
  onOpen: () => void;
}) {
  return (
    <button
      className="aggregateEndBtn"
      type="button"
      disabled={!node}
      title={node?.file ?? id}
      aria-label={`Go to ${end} ${node?.name ?? id}`}
      onClick={onOpen}
    >
      <span className="mono">{node?.name ?? id}</span>
      {node ? <span className="mutedText mono">{shortPath(node.file)}</span> : null}
    </button>
  );
}
