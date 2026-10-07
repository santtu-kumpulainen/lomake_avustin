// Adds the synthetic demo form library (Issue #24). Safe to run repeatedly: forms that already
// exist are skipped and never changed, and nothing is deleted.
// Usage: npm run seed:demo-forms
import { pool } from "../db.js";
import { seedDemoForms } from "../seeds/demo-forms.js";

try {
  const { created, skipped } = await seedDemoForms(pool);
  console.log(`Demo forms created: ${created.length}, already present: ${skipped.length}`);
  for (const key of created) console.log(`  + ${key}`);
} catch (err) {
  console.error("Seeding demo forms failed:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
