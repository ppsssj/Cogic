import { useEffect, useReducer, useState } from "react";

type Action = { type: "inc" } | { type: "dec" };

function reducer(state: number, action: Action): number {
  return action.type === "inc" ? state + 1 : state - 1;
}

export function Stepper(step: number) {
  const [value, dispatch] = useReducer(reducer, 0);
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    dispatch({ type: "inc" });
    setTicks(ticks + step);
  }, [ticks, step]);

  function down() {
    dispatch({ type: "dec" });
  }

  return { value, down };
}
