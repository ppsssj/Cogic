export interface Order {
  id: number;
  total: number;
}

export type Status = "open" | "closed";

export function audit(o: Order): void {
  void o;
}
