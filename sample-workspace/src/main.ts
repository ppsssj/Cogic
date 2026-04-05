import { compute } from "./b";
import { greet, answer } from "./c";

export function run() {
  console.log(greet("Cogic"));
  console.log("answer", answer);
  console.log("compute", compute(3));
}
run();
