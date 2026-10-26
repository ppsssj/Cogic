import { createContext, useContext, useRef, useState } from "react";
import { useMemo as memoize } from "./utils";

const ThemeContext = createContext("light");

function useToggle(initial: boolean) {
  const [on, setOn] = useState(initial);
  const flip = () => setOn(!on);
  return { on, flip };
}

export function Widget() {
  const theme = useContext(ThemeContext);
  const ref = useRef(0);
  const toggle = useToggle(theme === "dark");
  const cached = memoize(() => 1);

  function bump() {
    ref.current += cached;
  }

  return { toggle, bump };
}
