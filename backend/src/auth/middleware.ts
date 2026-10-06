import type { RequestHandler } from "express";
import { getSessionUser, type AuthUser, type Role } from "./sessions.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.user = user;
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return async (req, res, next) => {
    const user = req.user ?? (await getSessionUser(req));
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.user = user;
    next();
  };
}
