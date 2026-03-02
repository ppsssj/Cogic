const foo = () => {
  bar();
};

const baz = function () {
  qux();
};

class C {
  m = () => {
    foo();
  };
}

function bar() {}
function qux() {}