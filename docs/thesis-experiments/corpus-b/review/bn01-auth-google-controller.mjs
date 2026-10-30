// Review of the annotate-assist draft for bn01-auth-google-controller (src/auth-google/auth-google.controller.ts).
export function apply(gt, h) {
  // The route method's declaration starts at its first decorator (line 26, @ApiOkResponse); the anchor must be on that line.
  h.setNode("S_nest_route_owner_26_1", { anchor: "@ApiOkResponse(" });
  h.note("owner S_nest_route_owner_26_1", "@Controller (class) and @Post (method) are imported from @nestjs/common (guide §5.4). The node line is the method's start including decorators (line 26); @Post is on line 32.");
  h.note("references file X_LoginResponseDto_login_response_dto_ts_4", "Inside the @ApiOkResponse method decorator argument: decorator expressions belong to the owner of the class (the file; guide §3.4, D10).");
  h.note("references C_AuthGoogleController_15 X_AuthService_auth_service_ts_32", "Constructor parameter property types belong to the class (guide §3.2).");
}
