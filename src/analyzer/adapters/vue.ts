import * as ts from "typescript";
import type {
  FrameworkCallbackHookResolution,
  FrameworkSemanticAdapter,
  FrameworkStateHookResolution,
} from "./types";

const VUE_CALLBACK_HOOKS = new Set([
  "computed",
  "watch",
  "watchEffect",
  "watchPostEffect",
  "watchSyncEffect",
]);

const VUE_STATE_HOOKS = new Set([
  "ref",
  "shallowRef",
  "customRef",
  "reactive",
]);

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

const isVueImportDeclaration = (node: ts.Node | undefined): boolean => {
  const importDecl = getImportDeclaration(node);
  return !!(
    importDecl &&
    ts.isStringLiteral(importDecl.moduleSpecifier) &&
    importDecl.moduleSpecifier.text === "vue"
  );
};

const getVueImportKind = (symbol: ts.Symbol | undefined): string | null => {
  if (!symbol) {
    return null;
  }

  for (const decl of symbol.declarations ?? []) {
    if (!isVueImportDeclaration(decl)) {
      continue;
    }
    if (ts.isImportSpecifier(decl)) {
      return (decl.propertyName ?? decl.name).text;
    }
    if (ts.isNamespaceImport(decl)) {
      return "*";
    }
  }

  return null;
};

const resolveVueHook = (args: {
  checker: ts.TypeChecker;
  expression: ts.LeftHandSideExpression;
  allowedHooks: ReadonlySet<string>;
}): string | null => {
  const { checker, expression, allowedHooks } = args;

  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    const importedName = getVueImportKind(symbol);
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
    const importKind = getVueImportKind(baseSymbol);
    if (importKind === "*") {
      return expression.name.text;
    }
  }

  return null;
};

export const vueSemanticAdapter: FrameworkSemanticAdapter = {
  name: "vue",
  resolveCallbackHook({
    checker,
    expression,
  }): FrameworkCallbackHookResolution | null {
    const name = resolveVueHook({
      checker,
      expression,
      allowedHooks: VUE_CALLBACK_HOOKS,
    });
    if (!name) {
      return null;
    }
    return {
      name,
      callbackArgIndex: name === "watch" ? 1 : 0,
    };
  },
  resolveStateHook({
    checker,
    expression,
  }): FrameworkStateHookResolution | null {
    const name = resolveVueHook({
      checker,
      expression,
      allowedHooks: VUE_STATE_HOOKS,
    });
    return name ? { name, bindingKind: "identifier" } : null;
  },
};
