interface B {}
interface A extends B {}

interface IFoo {}
class Base {}
class C extends Base implements IFoo {}

type Foo = { x: number }
type Bar = { y: number }

type T1 = Foo | Bar
type T2 = Foo & Bar
type T3 = { a: IFoo }
type T4 = Array<Foo>