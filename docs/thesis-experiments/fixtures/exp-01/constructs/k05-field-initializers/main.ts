class ValidationError {
  constructor(public field: string) {}
}

class NotFoundError {
  constructor(public id: number) {}
}

class Logger {
  info(msg: string): void {
    void msg;
  }
}

class Repo {
  private log = new Logger();

  find(id: number): string {
    if (id < 0) {
      throw new ValidationError("id");
    }
    if (id === 0) {
      throw new NotFoundError(id);
    }
    this.log.info("found");
    return "item";
  }
}

export function createRepo(): Repo {
  return new Repo();
}

export function handle(id: number): string {
  try {
    return createRepo().find(id);
  } catch {
    throw new NotFoundError(id);
  }
}

export const makeLogger = (): Logger => new Logger();
