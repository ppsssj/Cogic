interface Shape {
  area(): number;
}

class Circle implements Shape {
  constructor(private r: number) {}

  area(): number {
    return 3 * this.r * this.r;
  }
}

class Square implements Shape {
  constructor(private s: number) {}

  area(): number {
    return this.s * this.s;
  }
}

class Triangle implements Shape {
  constructor(private b: number, private h: number) {}

  area(): number {
    return (this.b * this.h) / 2;
  }
}

export function makeShape(kind: string, size: number): Shape {
  if (kind === "circle") {
    return new Circle(size);
  }
  if (kind === "square") {
    return new Square(size);
  }
  return new Triangle(size, size);
}

export function defaults(): Shape[] {
  return [new Circle(1), new Square(1), new Triangle(1, 2)];
}

export function totalArea(shapes: Shape[]): number {
  let sum = 0;
  for (const s of shapes) {
    sum += s.area();
  }
  return sum;
}
