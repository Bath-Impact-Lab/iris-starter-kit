import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Dev-only: load a gitignored .env.local from the project root so we can override environment variables for local development.
if (!app.isPackaged) {
  const envFile = path.join(app.getAppPath(), '.env.local');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
    console.log(`[env] Loaded ${envFile}`);
  }
}
