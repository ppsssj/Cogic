// Review of the annotate-assist draft for bn05-files-service (src/files/infrastructure/uploader/local/files.service.ts).
export function apply(gt, h) {
  // fileRepository is typed as the abstract class FileRepository; create is an abstract method without a body.
  // The executed implementation is the subclass Nest injects at run time (guide §6.2: dynamic dispatch, unbounded).
  h.drop("calls F_create_19 X_create_file_repository_ts_5", "abstract method: implementation chosen by dependency injection");
  h.drop("dataflow F_create_19 X_create_file_repository_ts_5#0", "receiving parameter belongs to the injected implementation");
  h.add({ kind: "calls", source: "F_create_19", candidates: "unbounded", pattern: "CALL-INTERFACE-DISPATCH", gtStatus: "indeterminate", evidence: h.ev(30), reason: "this.fileRepository is typed as abstract class FileRepository (abstract create, no body); the concrete repository is injected at run time." });
  h.add({ kind: "dataflow", source: "F_create_19", candidates: "unbounded", pattern: "DF-INDIRECT", gtStatus: "indeterminate", evidence: h.ev(30), reason: "call target is indeterminate, so is the receiving parameter (guide §4.5)." });
}
