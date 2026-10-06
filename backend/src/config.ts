function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database: required("DB_NAME"),
  },
  session: {
    ttlHours: Number(process.env.SESSION_TTL_HOURS ?? 24),
    // Must be true when served over HTTPS; plain http://localhost needs false.
    cookieSecure: process.env.COOKIE_SECURE === "true",
  },
};
