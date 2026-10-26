import express, { Router } from "express";
import { sharedApp } from "./app";

function health(_req: unknown, _res: unknown): void {}

function legacy(_req: unknown, _res: unknown): void {}

function loadId(_req: unknown, _res: unknown): void {}

const topApp = express();
topApp.get("/health", health);

export function nested() {
  const app = express();
  const router = Router();
  app.route("/legacy").get(legacy);
  sharedApp.get("/shared", health);
  const notExpress = {
    get(path: string, handler: unknown): void {
      void path;
      void handler;
    },
  };
  notExpress.get("/fake", health);
  app.get("title");
  app.set("views", "dir");
  router.param("id", loadId);
  app.listen(3000);
}
