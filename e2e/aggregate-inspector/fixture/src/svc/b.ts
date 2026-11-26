import { log } from "./c";
import { helper } from "../app/a";
export function process(value: number): number { log(value); return value; }
export function store(value: number): number { return helper(value); }
export class Box {
  open(value: number) { return this.close(value); }
  close(value: number) { return process(value); }
}
