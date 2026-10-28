// Minimal JSX namespace for EXP-01 fixtures.
declare global {
  namespace JSX {
    interface Element {}
    interface IntrinsicElements {
      div: {};
      h1: {};
    }
  }
}
export {};
