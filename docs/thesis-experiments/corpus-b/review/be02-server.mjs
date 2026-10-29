// Review of the annotate-assist draft for be02-server (src/server.ts).
export function apply(gt, h) {
  const lines = [[20, 1], [21, 2], [22, 3], [23, 4], [24, 5], [27, 6], [30, 7], [31, 8], [34, 9], [37, 10]];
  for (const [line, k] of lines) {
    const id = `S_express_route_owner_${line}_${k}`;
    h.setNode(id, { anchor: "app.use" });
    h.set(`owner ${id}`, { pattern: "FW-EXPRESS-TOPLEVEL" });
  }
  h.note("owner S_express_route_owner_20_1", "Top-level app.use registrations on app = express() (EXP-01 e03 R01). Handlers returned by third-party calls (express.json(), urlencoded, cors(), helmet()) have no §2 node.");
  h.note("owner S_express_route_owner_24_5", "rateLimiter is the value of rateLimit({...}) (third-party), not a §2 node: owner without calls.");
  h.note("owner S_express_route_owner_30_7", "Router mount (healthCheckRouter = express.Router()): owner without calls (guide §5.3).");
  h.note("owner S_express_route_owner_31_8", "Router mount (userRouter): owner without calls (guide §5.3).");
  h.note("owner S_express_route_owner_34_9", "Router mount (openAPIRouter): owner without calls (guide §5.3).");
  // requestLogger's default export is the array literal [addRequestId, captureResponseBody, httpLogger].
  const addRequestId = h.node({ id: "X_addRequestId_requestLogger_ts_20", type: "external", file: "src/common/middleware/requestLogger.ts", line: 20, name: "addRequestId" });
  const capture = h.node({ id: "X_captureResponseBody_requestLogger_ts_47", type: "external", file: "src/common/middleware/requestLogger.ts", line: 47, name: "captureResponseBody" });
  h.add({ kind: "calls", source: "S_express_route_owner_27_6", target: addRequestId, pattern: "FW-UNSUPPORTED-OWNER-EDGE", gtStatus: "determinate", evidence: h.ev(27), note: "requestLogger (default export) is the array literal [addRequestId, captureResponseBody, httpLogger]; httpLogger = pinoHttp(...) is not a §2 node." });
  h.add({ kind: "calls", source: "S_express_route_owner_27_6", target: capture, pattern: "FW-UNSUPPORTED-OWNER-EDGE", gtStatus: "determinate", evidence: h.ev(27) });
  // errorHandler() returns the array literal [unexpectedRequest, addErrorToRequestLog].
  const unexpected = h.node({ id: "X_unexpectedRequest_errorHandler_ts_4", type: "external", file: "src/common/middleware/errorHandler.ts", line: 4, name: "unexpectedRequest" });
  const addErr = h.node({ id: "X_addErrorToRequestLog_errorHandler_ts_8", type: "external", file: "src/common/middleware/errorHandler.ts", line: 8, name: "addErrorToRequestLog" });
  h.add({ kind: "calls", source: "S_express_route_owner_37_10", target: unexpected, pattern: "FW-UNSUPPORTED-OWNER-EDGE", gtStatus: "determinate", evidence: h.ev(37), note: "errorHandler() (anonymous default-export arrow, not a §2 node) returns the array literal [unexpectedRequest, addErrorToRequestLog]; both are registered handlers." });
  h.add({ kind: "calls", source: "S_express_route_owner_37_10", target: addErr, pattern: "FW-UNSUPPORTED-OWNER-EDGE", gtStatus: "determinate", evidence: h.ev(37) });
  // app.set is not a route registration (EXP-01 e03 N03)
  const setNeg = h.node({ id: "S_express_set_17", type: "synthetic", file: "src/server.ts", line: 17, framework: "express", role: "route-owner", anchor: "app.set" });
  h.neg({ kind: "owner", source: setNeg, pattern: "NEG-EXPRESS-NONROUTE", evidence: h.ev(17), rationale: "app.set is a setting, not a route registration (guide §5.3)" });
}
