import { finish } from "./target";

export class Example {
  fetch: (value: number) => number = (value) => this.#dispatch(value);
  request = (value: number) => this.fetch(value);
  #dispatch(value: number) { return finish(value); }
  recursive(value: number): number { return value > 0 ? this.recursive(value - 1) : 0; }
}

export function start(value: number) { return new Example().request(value); }
