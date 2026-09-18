import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { validateEnvironment } from './environment.js';
import type { BackendEnvironment } from './environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveCliEnvironment(
  customEnvPath?: string,
  baseEnv: Record<string, string | undefined> = process.env,
): BackendEnvironment {
  const envFilePath = customEnvPath ?? path.resolve(__dirname, '../../.env');
  const mergedEnv: Record<string, string | undefined> = { ...baseEnv };

  if (fs.existsSync(envFilePath)) {
    const fileContent = fs.readFileSync(envFilePath, 'utf8');
    const parsed = dotenv.parse(fileContent);
    for (const [key, value] of Object.entries(parsed)) {
      // Real environment variables take precedence over .env file values
      if (baseEnv[key] === undefined) {
        mergedEnv[key] = value;
      }
    }
  }

  return validateEnvironment(mergedEnv);
}
