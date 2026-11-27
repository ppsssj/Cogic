function ClassDeco(name: string) {
  void name;
  return <T extends abstract new (...args: any[]) => object>(value: T, context: ClassDecoratorContext<T>): void => {
    void value; void context;
  };
}

function PlainClass(value: Function, context: ClassDecoratorContext): void {
  void value; void context;
}

function Method(name: string) {
  void name;
  return (value: Function, context: ClassMethodDecoratorContext): void => {
    void value; void context;
  };
}

function PlainMethod(value: Function, context: ClassMethodDecoratorContext): void {
  void value; void context;
}

function Field(name: string) {
  void name;
  return (value: undefined, context: ClassFieldDecoratorContext): void => {
    void value; void context;
  };
}

function helper(): string {
  return "h";
}

@ClassDeco("c")
@PlainClass
export class Sample {
  @Field(helper())
  field = 1;

  @Method("m")
  @PlainMethod
  method(y: string): string {
    return helper() + y;
  }
}
