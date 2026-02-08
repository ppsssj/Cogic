import { compute } from "./b";
import { greet, answer } from "./c";

export function run() {
  console.log(greet("CodeGraph"));
  console.log("answer", answer);
  console.log("compute", compute(3));
}
run();
