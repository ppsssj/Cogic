type CartItem = {
  name: string;
  price: number;
  quantity: number;
};
type Coupon =
  | { kind: "percent"; value: number }
  | { kind: "fixed"; value: number };
function subtotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
function applyDiscount(amount: number, coupon?: Coupon) {
  if (!coupon) return amount;
  if (coupon.kind === "percent") {
    return amount - coupon.value;
  }
  return amount - coupon.value;
}
function addTax(amount: number, taxRate: number) {
  return amount + amount * taxRate;
}
function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100;
}
class CheckoutService {
  checkout(items: CartItem[], coupon?: Coupon) {
    const base = subtotal(items);
    const discounted = applyDiscount(base, coupon);
    const taxed = addTax(discounted, 0.1);
    return roundMoney(taxed);
  }
}
export function runDemo() {
  const service = new CheckoutService();
  const cart: CartItem[] = [
    { name: "Keyboard", price: 12, quantity: 1 },
    { name: "Mouse", price: 8, quantity: 2 },
  ];
  const coupon: Coupon = { kind: "percent", value: 10 };
  const total = service.checkout(cart, coupon);
  console.log("Expected total: 27.72");
  console.log("Actual total:", total);
}
runDemo();
