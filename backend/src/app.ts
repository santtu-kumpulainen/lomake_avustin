import express, { type ErrorRequestHandler } from "express";
import { authRouter } from "./routes/auth.js";
import { formsRouter } from "./routes/forms.js";
import { healthRouter } from "./routes/health.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/forms", formsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Generic response so internal details never reach the client. Request bodies are not logged.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if ((err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  console.error(err instanceof Error ? err.message : err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);
