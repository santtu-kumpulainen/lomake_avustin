import mariadb from "mariadb";
import { config } from "./config.js";

export const pool = mariadb.createPool({
  ...config.db,
  connectionLimit: 5,
  // The driver adds query parameter values to error messages by default. They can hold user
  // answers and descriptions, and the error handler logs messages, so keep them out.
  logParam: false,
});

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
