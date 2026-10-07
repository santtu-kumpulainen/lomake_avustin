import express, { type ErrorRequestHandler } from "express";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { formsRouter } from "./routes/forms.js";
import { healthRouter } from "./routes/health.js";
import { profileRouter } from "./routes/profile.js";
import { submissionsRouter } from "./routes/submissions.js";
import { symptomDescriptionsRouter } from "./routes/symptom-descriptions.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/forms", formsRouter);
app.use("/api/submissions", submissionsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/profile", profileRouter);
app.use("/api/symptom-descriptions", symptomDescriptionsRouter);

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
