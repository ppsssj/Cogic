class Widget {
  static create(): Widget {
    return new Widget();
  }
}

class Gadget {}

export function check(v: unknown): boolean {
  return v instanceof Widget;
}

export function viaFactory(): Widget {
  return Widget.create();
}

export function typeOnly(g: Gadget): Gadget {
  return g;
}

export function cloneLike(w: Widget): Widget {
  return { ...w };
}
