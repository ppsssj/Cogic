// param-flow.ts — Parameter Dataflow Showcase
// 목적: "인자 → 매개변수" dataflow가 다양한 구문에서 잘 생성/표시되는지 확인

export type User = {
  id: number;
  name: string;
  meta?: { role?: string };
};

export function greet(user: User, prefix = "Hello"): string {
  // user -> greet.user
  // "Hi" -> greet.prefix (또는 default "Hello"가 들어갈 수도)
  return `${prefix}, ${user.name}!`;
}

export function add(a: number, b: number): number {
  // 2 -> add.a, 3 -> add.b
  return a + b;
}

// 오버로드 + 구현
export function fmt(v: number): string;
export function fmt(v: string, pad?: number): string;
export function fmt(v: number | string, pad = 0): string {
  // "9" -> fmt.v, 3 -> fmt.pad
  const s = String(v);
  return pad > 0 ? s.padStart(pad, "0") : s;
}

// 구조분해 파라미터
export function pickUser({ id, name }: User, keys: Array<"id" | "name">) {
  // u -> pickUser.{id,name}
  // ["id","name"] -> pickUser.keys
  return keys.map((k) => (k === "id" ? id : name));
}

// rest + reduce
export function sum(tag: string, ...xs: number[]) {
  // "sum" -> sum.tag
  // spread nums -> sum.xs (정책에 따라 nums -> xs 로 표현 가능)
  return `[${tag}] ${xs.reduce((acc, n) => acc + n, 0)}`;
}

export class Counter {
  constructor(public value = 0) {} // new Counter(10) -> Counter.constructor.value

  inc(step = 1) {
    // 2 -> Counter.inc.step
    this.value += step;
    return this.value;
  }

  dec(step?: number) {
    // (인자 없음) default 처리 여부는 정책
    // 5 -> Counter.dec.step
    this.value -= step ?? 1;
    return this.value;
  }
}

// 콜백/고차함수
export function withLog<T>(tag: string, fn: (x: number) => T, x: number): T {
  // "run" -> withLog.tag
  // (x)=>... -> withLog.fn
  // 7 -> withLog.x
  console.log("[withLog]", tag);
  return fn(x); // withLog.x -> fn.x
}

// -------------------- 실행 파트 (top-level calls) --------------------
const u: User = { id: 1, name: "Cogic", meta: { role: "dev" } };

console.log(greet(u)); // u -> greet.user (prefix default)
console.log(greet(u, "Hi")); // u -> greet.user, "Hi" -> greet.prefix

console.log("add:", add(2, 3)); // 2 -> add.a, 3 -> add.b

console.log("fmt1:", fmt(7)); // 7 -> fmt.v
console.log("fmt2:", fmt("9", 3)); // "9" -> fmt.v, 3 -> fmt.pad

console.log("pickUser:", pickUser(u, ["id", "name"])); // u -> pickUser.{id,name}, keys -> pickUser.keys

const nums = [1, 2, 3, 4];
console.log(sum("nums", ...nums)); // "nums" -> sum.tag, ...nums -> sum.xs

const c = new Counter(10); // 10 -> Counter.constructor.value
console.log("inc:", c.inc(), c.inc(2)); // 2 -> inc.step
console.log("dec:", c.dec(), c.dec(5)); // 5 -> dec.step
