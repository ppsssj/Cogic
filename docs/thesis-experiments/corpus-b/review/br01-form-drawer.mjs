// Review of the annotate-assist draft for br01-form-drawer (src/components/ui/form/form-drawer.tsx).
export function apply(gt, h) {
  h.setNode("S_react_callback_owner_33_1", { anchor: "React.useEffect" });
  h.note("owner S_react_callback_owner_33_1", "Inline useEffect callback through the namespace import React from react (guide §5.1).");
  h.set("calls F_FormDrawer_24 X_useDisclosure_use_disclosure_ts_3", { pattern: "CALL-PATH-ALIAS", note: "Custom hook imported through the @/ path alias: an ordinary call, not a framework owner (guide §5.1)." });
  h.note("calls F_FormDrawer_24 X_DrawerHeader_drawer_tsx_76", "DrawerHeader/DrawerFooter are arrow-function components in drawer.tsx. Drawer, DrawerTrigger, DrawerContent, DrawerTitle, DrawerClose and Button are values of third-party primitives or React.forwardRef(...) calls: not §2 nodes (excluded sites).");
  // useDisclosure is a user-defined hook (src/hooks/use-disclosure.ts): no React owner at its call (EXP-01 h03 N04).
  const neg = h.node({ id: "S_react_customhook_31", type: "synthetic", file: gt.activeFile, line: 31, framework: "react", role: "callback-owner", anchor: "useDisclosure" });
  h.neg({ kind: "owner", source: neg, pattern: "NEG-CUSTOM-HOOK", evidence: h.ev(31), rationale: "useDisclosure is a user function; the call is a calls relation and creates no React owner (guide §5.1)" });
}
