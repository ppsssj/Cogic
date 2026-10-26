// Minimal Express declaration shim for EXP-01 fixtures (not the real @types/express).
export interface Request {
  body: string;
}
export interface Response {
  send(body: unknown): void;
}
export type Handler = (req: Request, res: Response, next: () => void) => void;
export interface IRoute {
  get(...handlers: Handler[]): IRoute;
}
export interface Router {
  get(path: string, ...handlers: Handler[]): Router;
  post(path: string, ...handlers: Handler[]): Router;
  param(name: string, handler: Handler): Router;
}
export interface Application {
  get(path: string, ...handlers: Handler[]): Application;
  delete(path: string, ...handlers: Handler[]): Application;
  use(...args: unknown[]): Application;
  route(path: string): IRoute;
  set(name: string, value: unknown): Application;
  listen(port: number): void;
}
export declare function Router(): Router;
declare function express(): Application;
export default express;
