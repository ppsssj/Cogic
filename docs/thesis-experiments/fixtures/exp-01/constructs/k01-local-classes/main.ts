class Point {
  constructor(public x: number, public y: number) {}
}

class Empty {}

class Line {
  start: Point;
  end: Point;

  constructor(a: Point, b: Point) {
    this.start = a;
    this.end = b;
  }
}

export function origin(): Point {
  return new Point(0, 0);
}

export function unit(): Line {
  return new Line(new Point(0, 0), new Point(1, 1));
}

export function blank(): Empty {
  return new Empty();
}

export const shared = new Empty();
