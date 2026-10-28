import express from "express";

function auth(_req: unknown, _res: unknown, _next: () => void): void {}

function listOrders(_req: unknown, _res: unknown): void {}

function showOrder(_req: unknown, _res: unknown): void {}

function removeOrder(_req: unknown, _res: unknown): void {}

function audit(_req: unknown, _res: unknown): void {}

export function mount() {
  const app = express();
  app.use(audit);
  app.get("/orders", listOrders);
  app.get("/orders/:id", auth, showOrder);
  app.delete("/orders/:id", auth, removeOrder);
  return app;
}
