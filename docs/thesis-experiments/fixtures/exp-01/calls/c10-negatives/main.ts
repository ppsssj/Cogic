function target(): number {
  return 1;
}

function other(): number {
  return 2;
}

export function onlyType(): typeof target {
  return other;
}

export function comment(): number {
  // target();
  const text: string = "target()";
  return text === "" ? 0 : other();
}

export function localShadow(): number {
  const target = (): number => 3;
  return target();
}

export function paramShadow(target: number): number {
  return target + 1;
}

export function propertyName(): number {
  const box = { target: 1 };
  return box.target;
}
