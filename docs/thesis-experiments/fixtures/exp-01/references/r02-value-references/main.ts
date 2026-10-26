function validate(v: string): boolean {
  return v !== "";
}

function transform(v: string): string {
  return `${v}!`;
}

export const pipeline = [validate, transform];

export function pick(flag: boolean): (v: string) => unknown {
  return flag ? validate : transform;
}

export const registry = {
  check: validate,
  convert(v: string): string {
    return transform(v);
  },
};

export class Form {
  validator = validate;

  submit(v: string): boolean {
    const fn = this.validator;
    return fn(v);
  }
}
