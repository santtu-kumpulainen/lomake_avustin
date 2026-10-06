import { Router } from "express";
import { checkDatabase } from "../db.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const databaseOk = await checkDatabase();
  res.status(databaseOk ? 200 : 503).json({
    status: databaseOk ? "ok" : "degraded",
    service: "backend",
    database: databaseOk ? "ok" : "unreachable",
    timestamp: new Date().toISOString(),
  });
});
