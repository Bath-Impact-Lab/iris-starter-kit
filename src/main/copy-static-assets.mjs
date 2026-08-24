import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const assets = [
  ['electron/iris/pipeline-template.json', 'dist-electron/iris/pipeline-template.json'],
];

for (const [from, to] of assets) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
