export class User {
  constructor(public name: string) {}
}

export class Admin extends User {
  level = 1;
}

export class Registry {
  private items: User[] = [];

  add(u: User): void {
    this.items = [...this.items, u];
  }
}
