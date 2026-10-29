// Review of the annotate-assist draft for bn02-session-repository.
export function apply(gt, h) {
  h.note("references file X_SessionEntity_session_entity_ts_15", "@InjectRepository(SessionEntity) is a parameter decorator: it belongs to the owner of the class (the file; guide §3.4).");
  h.note("calls F_findById_20 lib_Number", "Number(id) calls the NumberConstructor call signature (TS lib). sessionRepository is a typeorm Repository (untyped third-party): its calls are excluded sites.");
}
