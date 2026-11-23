export type PipelineRecord = {
  requestId: string;
  event: string;
  monotonicMs: number;
  webview?: { monotonicMs?: number; [key: string]: unknown };
};

/** Keep clock domains separate and retain missing stages as null, never as zero. */
export function summarizePipeline(records: PipelineRecord[]) {
  const ids = [...new Set(records.map((record) => record.requestId))];
  return ids.map((requestId) => {
    const group = records.filter((record) => record.requestId === requestId);
    const host = (event: string) => group.find((record) => record.event === event)?.monotonicMs;
    const web = (event: string) => group.find((record) => record.event === `pipeline.${event}`)?.webview?.monotonicMs;
    const duration = (start: number | undefined, end: number | undefined) =>
      start === undefined || end === undefined || end < start ? null : end - start;
    const begins = group.filter((record) => record.event === "request.begin").length;
    const dropped = group.some((record) => record.event === "request.dropped" || record.event === "pipeline.result.dropped");
    return {
      requestId,
      duplicateBegin: begins > 1,
      status: dropped ? "dropped" : group.some((record) => record.event === "request.failed") ? "failed" : group.some((record) => record.event === "pipeline.canvas.twoAnimationFrames") ? "frame-observed" : "incomplete",
      hostRequestToPostMs: duration(host("request.begin"), host("postMessage.call")),
      hostPostToWebviewAckMs: duration(host("postMessage.call"), host("pipeline.result.received")),
      webRequestToReceiveMs: duration(web("request.sent"), web("result.received")),
      webReceiveToCommitMs: duration(web("result.received"), web("canvas.commit")),
      webReceiveToTwoFramesMs: duration(web("result.received"), web("canvas.twoAnimationFrames")),
    };
  });
}
