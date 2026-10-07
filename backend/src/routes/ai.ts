import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { buildExplainMessages, EXPLANATION_MAX, validateExplainInput } from "../ai/explain.js";
import { AiUnavailableError, chat } from "../ai/ollama.js";

export const aiRouter = Router();

aiRouter.post("/explain", requireAuth, async (req, res) => {
  const result = validateExplainInput(req.body);
  if (!result.ok) {
    res.status(400).json({ error: "Validation failed", fields: result.errors });
    return;
  }

  try {
    const text = await chat(buildExplainMessages(result.input));
    res.json({ explanation: text.slice(0, EXPLANATION_MAX) });
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    // Only the failure category is logged, never the question or model output.
    console.error(`AI explain failed: ${err.reason}`);
    res.status(503).json({ error: "AI unavailable" });
  }
});
