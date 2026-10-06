import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const server = app.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
});

// Close cleanly so `docker compose stop` does not wait for the kill timeout.
function shutdown() {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
