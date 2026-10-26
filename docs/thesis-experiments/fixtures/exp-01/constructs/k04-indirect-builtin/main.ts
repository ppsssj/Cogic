class Box<T> {
  constructor(public value: T) {}
}

type BoxFactory = new (v: number) => Box<number>;

export function viaVariable(): Box<number> {
  const Ctor: BoxFactory = Box;
  return new Ctor(1);
}

export function viaGeneric(): Box<string> {
  return new Box<string>("a");
}

export function notConstructed(): typeof Box {
  return Box;
}

export function builtin(): Map<string, number> {
  return new Map();
}
