import express, { Router } from "express";

function loadUsers(): string[] {
  return ["a"];
}

function saveUser(name: string): boolean {
  return name !== "";
}

export function registerRoutes() {
  const app = express();
  const router = Router();

  app.get("/users", (_req, res) => {
    res.send(loadUsers());
  });

  router.post("/users", (req, res) => {
    res.send(saveUser(req.body));
  });

  app.use("/api", router);
  return app;
}
