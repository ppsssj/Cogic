import * as React from "react";
import { useCallback, useLayoutEffect, useMemo, useState as useLocalState } from "react";

function expensive(n: number): number {
  return n * 2;
}

export function Panel(seed: number) {
  const [open, setOpen] = useLocalState(false);
  const [size, setSize] = React.useState(seed);

  const doubled = useMemo(() => expensive(size), [size]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  React.useEffect(() => {
    setSize(doubled);
  }, [doubled]);

  useLayoutEffect(onLayout, []);

  function onLayout() {
    setOpen(true);
  }

  return { open, close };
}
