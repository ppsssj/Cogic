// Review of the annotate-assist draft for be05-usercontroller (src/api/user/userController.ts).
export function apply(gt, h) {
  h.set("constructs file C_UserController_5", { pattern: "CONS-TOPLEVEL" });
  h.note("constructs file C_UserController_5", "UserController has no explicit constructor; new at module top level (EXP-01 k01 R14).");
  h.note("dataflow F_getUser_11 lib_Number_parseInt#1", "Number.parseInt(string, radix?): radix 10 is passed (index 1).");
  h.note("calls F_getUsers_6 X_findAll_userService_ts_16", "userService is the module-level instance new UserService() in userService.ts; findAll is its method.");
}
