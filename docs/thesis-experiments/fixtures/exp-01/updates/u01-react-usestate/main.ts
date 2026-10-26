import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  const [label, setLabel] = useState("idle");

  function increment() {
    setCount((c) => c + 1);
    setLabel("busy");
  }

  function reset() {
    setCount(0);
    setLabel("idle");
  }

  const toggle = () => {
    setLabel(label === "idle" ? "busy" : "idle");
  };

  return { count, increment, reset, toggle };
}
