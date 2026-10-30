// Review of the annotate-assist draft for be01-userrouter (src/api/user/userRouter.ts).
export function apply(gt, h) {
  // Both registrations are module top-level statements: unsupported top-level route owners (EXP-01 e03 R01/R02).
  h.setNode("S_express_route_owner_21_1", { anchor: "userRouter.get" });
  h.setNode("S_express_route_owner_31_2", { anchor: "userRouter.get" });
  h.set("owner S_express_route_owner_21_1", { pattern: "FW-EXPRESS-TOPLEVEL" });
  h.set("owner S_express_route_owner_31_2", { pattern: "FW-EXPRESS-TOPLEVEL" });
  h.set("calls S_express_route_owner_21_1 X_getUsers_userController_ts_6", { pattern: "FW-UNSUPPORTED-OWNER-EDGE" });
  h.set("calls S_express_route_owner_31_2 X_getUser_userController_ts_11", { pattern: "FW-UNSUPPORTED-OWNER-EDGE" });
  h.note("calls S_express_route_owner_31_2 X_getUser_userController_ts_11", "Handlers are validateRequest(GetUserSchema) (its return value is an anonymous function, not a §2 node) and userController.getUser.");
  // file-owned calls are CALL-TOPLEVEL (EXP-01 e03 R04)
  h.set("calls file X_createApiResponse_openAPIResponseBuilders_ts_6", { pattern: "CALL-TOPLEVEL" });
  h.set("calls file X_validateRequest_httpHandlers_ts_7", { pattern: "CALL-TOPLEVEL" });
  h.note("dataflow file X_createApiResponse_openAPIResponseBuilders_ts_6#1", "createApiResponse(schema, description, statusCode = OK): the defaulted third parameter is never passed (no dataflow).");
}
