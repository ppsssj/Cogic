import { reactSemanticAdapter } from "./react";
import { vueSemanticAdapter } from "./vue";

export {
  resolveFrameworkCallbackHook,
  resolveFrameworkStateHook,
} from "./types";
export type {
  FrameworkCallbackHookResolution,
  FrameworkSemanticAdapter,
  FrameworkStateHookResolution,
} from "./types";

export const defaultFrameworkSemanticAdapters = [
  reactSemanticAdapter,
  vueSemanticAdapter,
] as const;
