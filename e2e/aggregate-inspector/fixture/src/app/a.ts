import { process, store, Box } from "../svc/b";
import { log } from "../svc/c";
export function calculate(amount: number) { log(amount); return process(amount); }
export function validate(input: number) { return process(input); }
export function format(text: number) { store(text); return process(text); }
export class Pair {
  constructor(value: string);
  constructor(key: number, value: string);
  constructor(a: unknown, b?: unknown) { console.log(a, b); }
}
// Two relations with the same label ("value <- word"): arg#0 and arg#1 of two overloads.
export function twice(word: string) { new Pair(word); new Pair(1, word); }
export function helper(x: number) { return x + 1; }
export class Local {
  run(v: number) { const box = new Box(); box.open(v); return this.again(v); }
  again(v: number) { return process(v); }
}
