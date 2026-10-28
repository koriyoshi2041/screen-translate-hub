import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const exec = promisify(execFile);
for (const scale of [1, 1.5, 2]) {
  test(`native overlay pixels and first assistant focus at ${scale * 100}%`, { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
    mkdirSync(join(root, 'tmp'), { recursive: true });
    const dir = mkdtempSync(join(root, 'tmp', 'desktop-regression-'));
    const driver = join(dir, 'driver.cjs');
    const result = join(dir, 'result.json');
    try {
      await build({ entryPoints: [join(import.meta.dirname, 'native-driver.ts')], outfile: driver, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'koffi'], logLevel: 'silent' });
      const electron = createRequire(import.meta.url)('electron') as unknown as string;
      const env: NodeJS.ProcessEnv = { ...process.env, STH_DESKTOP_TEST_DIR: dir, STH_DESKTOP_TEST_RESULT: result, STH_TEST_ROOT: root };
      delete env.ELECTRON_RUN_AS_NODE;
      try {
        await exec(electron, [driver, `--force-device-scale-factor=${scale}`], { cwd: root, env, timeout: 45_000 });
      } catch (error) {
        if (existsSync(result)) assert.equal(JSON.parse(readFileSync(result, 'utf8')).ok, true, readFileSync(result, 'utf8'));
        throw error;
      }
      const actual = JSON.parse(readFileSync(result, 'utf8'));
      assert.equal(actual.ok, true, JSON.stringify(actual));
      assert.equal(actual.scale, scale, 'requested DPI configuration is active');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
}
