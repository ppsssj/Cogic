import { clamp, upper } from "./lib";
import { lower, upper as up2 } from "@lib/strings";

export function label(v: number): string {
  const c = clamp(v, 0, 10);
  return upper(`v${c}`) + up2("x") + lower("y");
}
