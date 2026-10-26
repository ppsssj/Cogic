export class Vec {
  constructor(public x: number, public y: number) {}
}

export class Rect {
  constructor(public from: Vec, public to: Vec) {}
}

export class Color {
  constructor(public r: number, public g: number, public b: number) {}
}
