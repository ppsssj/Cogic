import { audit, type Order, type Status } from "./types";

export function close(order: Order): Status {
  audit(order);
  return "closed";
}

export function hook(): (o: Order) => void {
  return audit;
}
