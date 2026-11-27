function ClassDeco(name: string): ClassDecorator {
  void name;
  return () => {};
}

function PlainClass(target: Function): void {
  void target;
}

function Method(name: string): MethodDecorator {
  void name;
  return () => {};
}

function PlainMethod(target: object, key: string | symbol, desc: PropertyDescriptor): void {
  void target; void key; void desc;
}

function Prop(name: string): PropertyDecorator {
  void name;
  return () => {};
}

function Param(name: string): ParameterDecorator {
  void name;
  return () => {};
}

function helper(): string {
  return "h";
}

@ClassDeco("c")
@PlainClass
export class Sample {
  @Prop(helper())
  field = 1;

  constructor(@Param("x") x: number) {
    void x;
  }

  @Method("m")
  @PlainMethod
  method(@Param("y") y: string): string {
    return helper() + y;
  }
}

export class Nested {
  run(): void {
    class Inner {
      @Method("inner")
      go(): void {}
    }
    void Inner;
  }
}
