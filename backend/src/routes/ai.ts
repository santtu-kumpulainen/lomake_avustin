import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { buildExplainMessages, EXPLANATION_MAX, validateExplainInput } from "../ai/explain.js";
import { AiUnavailableError, chat } from "../ai/ollama.js";
import {
  buildRecommendMessages,
  parseRecommendation,
  RECOMMENDATION_FORMAT,
  type Candidate,
} from "../ai/recommend.js";
import { pool } from "../db.js";
import { validateSymptomDescription } from "../symptoms/validation.js";

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

// Customers only. The body may contain only `description`: the candidate list, owner and role
// are decided here, so a client cannot steer the model towards hidden forms. The description is
// sent to Ollama for this request only; it is not stored, logged or echoed back.
aiRouter.post("/recommend-form", requireRole("USER"), async (req, res) => {
  const result = validateSymptomDescription(req.body);
  if (!result.ok) {
    res.status(400).json({ error: "Validation failed", fields: result.errors });
    return;
  }

  // Same visibility as the customer's form list. LIMIT bounds the prompt size.
  const candidates: Candidate[] = await pool.query(
    `SELECT id, name, description, category FROM form_templates
      WHERE status = 'PUBLISHED'
      ORDER BY name, id
      LIMIT 50`,
  );
  if (candidates.length === 0) {
    res.json({ recommendation: null });
    return;
  }

  try {
    const raw = await chat(buildRecommendMessages(candidates, result.description), RECOMMENDATION_FORMAT);
    const choice = parseRecommendation(raw, candidates);
    if (!choice) {
      res.json({ recommendation: null });
      return;
    }
    // Name and topic come from the database, not from the model.
    const form = candidates.find((c) => c.id === choice.formId)!;
    res.json({
      recommendation: { formId: form.id, name: form.name, category: form.category, reason: choice.reason },
    });
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    console.error(`AI recommend failed: ${err.reason}`);
    res.status(503).json({ error: "AI unavailable" });
  }
});
