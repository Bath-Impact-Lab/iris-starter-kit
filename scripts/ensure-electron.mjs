#!/usr/bin/env node
// Runs before electron-vite starts Electron (see the dev and preview scripts).
// npm 12+ skips dependency install scripts that aren't in the root
// package.json's allowScripts, and approving one later doesn't re-run it, so
// node_modules/electron can be left without its binary and electron-vite then
// fails with "Electron uninstall". If the binary is missing, run Electron's own
// installer (the script npm skipped) instead of failing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

function fail(message) {
  console.error(`[ensure-electron] ${message}`);
  process.exit(1);
}

let electronDir;
try {
  electronDir = path.dirname(createRequire(import.meta.url).resolve('electron/package.json'));
} catch {
  fail('Electron is not installed, run npm install first.');
}

// electron-vite finds the executable through path.txt, which Electron's
// installer writes after unpacking the binary into dist/.
function binaryInstalled() {
  try {
    const executable = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8');
    return executable !== '' && fs.existsSync(path.join(electronDir, 'dist', executable));
  } catch {
    return false;
  }
}

// electron-vite skips that lookup when ELECTRON_EXEC_PATH is set.
if (!process.env.ELECTRON_EXEC_PATH && !binaryInstalled()) {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    fail('The Electron binary is missing and ELECTRON_SKIP_BINARY_DOWNLOAD is set. Unset it and try again.');
  }
  console.log('[ensure-electron] Electron binary missing, running Electron\'s installer');
  const result = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' });
  if (result.error) {
    fail(`Could not run Electron's installer: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Electron's installer failed (exit code ${result.status ?? result.signal}), see its output above.`);
  }
  if (!binaryInstalled()) {
    // Electron 34 unzips with extract-zip, whose yauzl 2 dependency stops
    // after the first file on Node 26 while the installer still exits 0.
    fail('Electron\'s installer exited without unpacking the binary. Check that `npm ls yauzl` shows 3.x (see "overrides" in the root package.json).');
  }
}
