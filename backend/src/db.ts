import mariadb from "mariadb";
import { config } from "./config.js";

export const pool = mariadb.createPool({
  ...config.db,
  connectionLimit: 5,
});

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
