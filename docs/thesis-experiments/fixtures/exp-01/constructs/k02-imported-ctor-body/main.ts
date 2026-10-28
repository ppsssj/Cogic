import { Admin, Registry, User } from "./models";

function normalize(name: string): string {
  return `${name}`;
}

class Session {
  readonly user: User;

  constructor(name: string) {
    this.user = new User(normalize(name));
  }
}

export function bootstrap(): Registry {
  const reg = new Registry();
  reg.add(new Admin("root"));
  reg.add(new Session("guest").user);
  return reg;
}
