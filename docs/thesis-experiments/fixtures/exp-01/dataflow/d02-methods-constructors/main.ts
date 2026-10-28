class Account {
  constructor(public owner: string, public balance: number) {}

  deposit(amount: number, note?: string): number {
    void note;
    return this.balance + amount;
  }
}

function fee(amount: number, rate: number): number {
  return amount * rate;
}

const api = {
  send(to: string, body: string): boolean {
    return to !== body;
  },
};

export function transfer(from: Account, to: string, amount: number): boolean {
  const cost = fee(amount, 0.01);
  from.deposit(-amount - cost);
  return api.send(to, `${amount}`);
}

export function open(owner: string): Account {
  const acc = new Account(owner, 0);
  acc.deposit(10, "welcome");
  return acc;
}
