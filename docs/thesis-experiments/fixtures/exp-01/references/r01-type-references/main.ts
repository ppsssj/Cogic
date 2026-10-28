interface Address {
  city: string;
}

interface Person {
  name: string;
  address: Address;
}

type Id = string | number;

enum Role {
  Admin,
  Guest,
}

type Account = {
  id: Id;
  owner: Person;
  role: Role;
};

export function describe(p: Person): string {
  return p.name;
}

export function roleOf(a: Account): string {
  return a.role === Role.Admin ? "admin" : "guest";
}

export function key(id: Id): Id {
  return id;
}
