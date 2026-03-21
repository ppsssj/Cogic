type DebugDetail = Record<string, unknown> | undefined;

type PanelDebugEntry = {
  seq: number;
  at: string;
  event: string;
  detail?: DebugDetail;
};

const MAX_DEBUG_ENTRIES = 80;
const entries: PanelDebugEntry[] = [];
let nextSeq = 1;

export function pushPanelDebugEvent(event: string, detail?: DebugDetail) {
  const entry: PanelDebugEntry = {
    seq: nextSeq++,
    at: new Date().toISOString(),
    event,
    detail,
  };
  entries.push(entry);
  if (entries.length > MAX_DEBUG_ENTRIES) {
    entries.splice(0, entries.length - MAX_DEBUG_ENTRIES);
  }
  return entry;
}

export function dumpPanelDebugBuffer(
  reason: string,
  detail?: DebugDetail,
  recentCount = 25,
) {
  void reason;
  void detail;
  void recentCount;
}
