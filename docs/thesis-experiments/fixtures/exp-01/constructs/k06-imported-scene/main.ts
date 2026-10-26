import { Color, Rect, Vec } from "./geometry";

export class Scene {
  private items: Rect[] = [];

  addRect(x: number, y: number): Rect {
    const r = new Rect(new Vec(x, y), new Vec(x + 1, y + 1));
    this.items = [...this.items, r];
    return r;
  }

  background(): Color {
    return new Color(0, 0, 0);
  }
}

export function demo(): Scene {
  const scene = new Scene();
  scene.addRect(0, 0);
  return scene;
}

export function palette(): Color[] {
  return [new Color(255, 0, 0), new Color(0, 255, 0)];
}
