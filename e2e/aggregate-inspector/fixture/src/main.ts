import { calculate, validate, format, twice } from "./app/a";
import { many } from "./app/many";
export function main(n: number) { calculate(n); validate(n); format(n); twice("x"); many(n); }
main(1);
