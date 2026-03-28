import * as ts from "typescript";
import type {
  FrameworkCallbackHookResolution,
  FrameworkSemanticAdapter,
  FrameworkStateHookResolution,
} from "./types";

const REACT_CALLBACK_HOOKS = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useMemo",
  "useCallback",
]);

const REACT_STATE_HOOKS = new Set(["useState", "useReducer"]);

const getImportDeclaration = (
  node: ts.Node | undefined,
): ts.ImportDeclaration | null => {
  let current = node;
  while (current) {
    if (ts.isImportDeclaration(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
};

const isReactImportDeclaration = (node: ts.Node | undefined): boolean => {
  const importDecl = getImportDeclaration(node);
  return !!(
    importDecl &&
    ts.isStringLiteral(importDecl.moduleSpecifier) &&
    importDecl.moduleSpecifier.text === "react"
  );
};

const getReactImportKind = (
  symbol: ts.Symbol | undefined,
): string | null => {
  if (!symbol) {
    return null;
  }

  for (const decl of symbol.declarations ?? []) {
    if (!isReactImportDeclaration(decl)) {
      continue;
    }
    if (ts.isImportSpecifier(decl)) {
      return (decl.propertyName ?? decl.name).text;
    }
    if (ts.isNamespaceImport(decl)) {
      return "*";
    }
    if (ts.isImportClause(decl) && decl.name) {
      return "default";
    }
  }

  return null;
};

const resolveReactHook = (args: {
  checker: ts.TypeChecker;
  expression: ts.LeftHandSideExpression;
  allowedHooks: ReadonlySet<string>;
}): string | null => {
  const { checker, expression, allowedHooks } = args;

  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    const importedName = getReactImportKind(symbol);
    if (importedName && allowedHooks.has(importedName)) {
      return importedName;
    }
    return null;
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    allowedHooks.has(expression.name.text)
  ) {
    const baseSymbol = checker.getSymbolAtLocation(expression.expression);
    const importKind = getReactImportKind(baseSymbol);
    if (importKind === "default" || importKind === "*") {
      return expression.name.text;
    }
  }

  return null;
};

export const reactSemanticAdapter: FrameworkSemanticAdapter = {
  name: "react",
  resolveCallbackHook({
    checker,
    expression,
  }): FrameworkCallbackHookResolution | null {
    const name = resolveReactHook({
      checker,
      expression,
      allowedHooks: REACT_CALLBACK_HOOKS,
    });
    return name ? { name, callbackArgIndex: 0 } : null;
  },
  resolveStateHook({
    checker,
    expression,
  }): FrameworkStateHookResolution | null {
    const name = resolveReactHook({
      checker,
      expression,
      allowedHooks: REACT_STATE_HOOKS,
    });
    return name ? { name, bindingKind: "tuple" } : null;
  },
};
