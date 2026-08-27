import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function writeTempConfigFile(config: Record<string, any>) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-'));
  const cfgPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
  return { tmpDir, cfgPath };
}
