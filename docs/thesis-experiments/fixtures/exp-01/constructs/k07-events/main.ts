class Emitter {
  on(event: string, handler: () => void): void {
    void event;
    void handler;
  }

  emit(event: string): void {
    void event;
  }
}

class Timer {
  constructor(public ms: number) {}
}

export function wire(): Emitter {
  const e = new Emitter();
  const t = new Timer(100);
  e.on("tick", () => {
    e.emit(`${t.ms}`);
  });
  return e;
}

export function restart(): Timer {
  return new Timer(0);
}

export class Clock {
  timer = new Timer(1000);
  emitter = new Emitter();
}
