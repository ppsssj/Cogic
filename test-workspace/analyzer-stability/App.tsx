import { useCallback, useEffect, useMemo } from "react";
import { Button } from "./Button";

function helper(value: number) {
  return value + 1;
}

export function App({ value }: { value: number }) {
  useEffect(() => {
    helper(value);
  }, [value]);

  const computed = useMemo(() => helper(value), [value]);
  const onClick = useCallback(() => helper(computed), [computed]);

  return <Button />;
}
