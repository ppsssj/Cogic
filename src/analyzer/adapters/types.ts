import * as ts from "typescript";

export interface FrameworkCallbackHookResolution {
  name: string;
  callbackArgIndex: number;
}

export interface FrameworkStateHookResolution {
  name: string;
  bindingKind: "tuple" | "identifier";
}

export interface FrameworkSemanticAdapter {
  name: string;
  resolveCallbackHook?(args: {
    checker: ts.TypeChecker;
    expression: ts.LeftHandSideExpression;
  }): FrameworkCallbackHookResolution | null;
  resolveStateHook?(args: {
    checker: ts.TypeChecker;
    expression: ts.LeftHandSideExpression;
  }): FrameworkStateHookResolution | null;
}

export function resolveFrameworkCallbackHook(args: {
  adapters: readonly FrameworkSemanticAdapter[];
  checker: ts.TypeChecker;
  expression: ts.LeftHandSideExpression;
}): FrameworkCallbackHookResolution | null {
  const { adapters, checker, expression } = args;

  for (const adapter of adapters) {
    const hook = adapter.resolveCallbackHook?.({
      checker,
      expression,
    });
    if (hook) {
      return hook;
    }
  }

  return null;
}

export function resolveFrameworkStateHook(args: {
  adapters: readonly FrameworkSemanticAdapter[];
  checker: ts.TypeChecker;
  expression: ts.LeftHandSideExpression;
}): FrameworkStateHookResolution | null {
  const { adapters, checker, expression } = args;

  for (const adapter of adapters) {
    const hook = adapter.resolveStateHook?.({
      checker,
      expression,
    });
    if (hook) {
      return hook;
    }
  }

  return null;
}
