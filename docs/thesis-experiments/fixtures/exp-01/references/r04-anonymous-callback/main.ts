interface Item {
  id: number;
}

function isValid(item: Item): boolean {
  return item.id > 0;
}

function format(item: Item): string {
  return `#${item.id}`;
}

export function summarize(items: Item[]): string[] {
  return items.filter((it) => isValid(it)).map((it: Item) => format(it));
}

function defer(task: () => void): void {
  void task;
}

export function register(): void {
  defer(() => {
    const f = format;
    void f;
  });
}
