const handlers = {
  start(): string {
    return "start";
  },
  stop(): string {
    return "stop";
  },
};

type HandlerName = keyof typeof handlers;

export function dispatchFixed(): string {
  return handlers["start"]();
}

export function dispatch(name: HandlerName): string {
  return handlers[name]();
}

function greet(greeting: string): string {
  return `${greeting}!`;
}

export function callBound(): string {
  const bound = greet.bind(null);
  return greet.call(null, "hi") + bound("yo");
}
