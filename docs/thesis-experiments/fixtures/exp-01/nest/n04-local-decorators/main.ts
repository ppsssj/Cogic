function Controller(prefix?: string): ClassDecorator {
  void prefix;
  return () => {};
}

function Get(path?: string): MethodDecorator {
  void path;
  return () => {};
}

@Controller("fake")
export class FakeController {
  @Get("a")
  a(): string {
    return "a";
  }

  @Get("b")
  b(): string {
    return "b";
  }
}
