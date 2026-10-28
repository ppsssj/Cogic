import { useState } from "react";

function setTitle(title: string): string {
  return title;
}

export function Viewer() {
  const [count, setCount] = useState(0);

  function show(): number {
    return count;
  }

  function shadow(): number {
    let count = 0;
    count++;
    return count;
  }

  function rename(): string {
    return setTitle("new");
  }

  function expose() {
    return setCount;
  }

  return { show, shadow, rename, expose };
}
