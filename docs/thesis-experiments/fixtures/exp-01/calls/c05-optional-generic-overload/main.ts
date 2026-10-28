const notify = (msg: string): void => {
  void msg;
};

function identity<T>(value: T): T {
  return value;
}

function format(value: number): string;
function format(value: string): string;
function format(value: number | string): string {
  return `${value}`;
}

class Service {
  stop(): void {}
}

export function main(svc?: Service): string {
  notify?.("start");
  svc?.stop();
  const n = identity(42);
  const s = identity<string>("x");
  return format(n) + format(s);
}
