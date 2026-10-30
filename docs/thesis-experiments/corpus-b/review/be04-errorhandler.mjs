// Review of the annotate-assist draft for be04-errorhandler (src/common/middleware/errorHandler.ts).
export function apply(gt, h) {
  h.note("calls F_addErrorToRequestLog_8", "next is the Express-supplied NextFunction parameter (guide §6.2 unbounded).");
  h.note("references file F_unexpectedRequest_4", "Owner is the file: the default export is an anonymous arrow function (guide §2, not a node; §3.5).");
}
