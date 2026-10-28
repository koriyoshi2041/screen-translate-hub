// Isolated Electron regression fixture: no capture, real AI, or user settings.
import assert from 'node:assert/strict';
import { app, BrowserWindow, screen } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { defaultSettings } from '@sth/render';
import type { Peer } from '@sth/wire';
import { OverlayHost, type WindowEnv } from '../src/main/host.ts';
import { AssistantCard } from '../src/main/assistant-card.ts';
import { windowFrame } from '../src/main/win32.ts';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.env.STH_DESKTOP_TEST_DIR!, 'profile'));
const until = async (f: () => boolean, description: string) => {
  const end = Date.now() + 15_000;
  while (!f()) {
    assert.ok(Date.now() < end, description);
    await sleep(30);
  }
};

void app.whenReady().then(async () => {
  let host: OverlayHost | undefined;
  let card: AssistantCard | undefined;
  try {
    const root = process.env.STH_TEST_ROOT!;
    const env: WindowEnv = {
      preload: join(root, 'apps/desktop/dist/preload.cjs'),
      rendererDir: join(root, 'apps/desktop/dist/renderer'),
      debugCapturable: false,
      settings: () => defaultSettings('overlay'),
    };
    host = new OverlayHost(env, { x: 40, y: 40, w: 900, h: 600 }, { topmost: false });
    await until(() => host!.stats.paints > 0, 'overlay paint');
    assert.deepEqual(host.stats.size, [900, 600], 'bitmap must use physical pixels');
    assert.equal(windowFrame(host.hwnd)?.w, 900, 'native width');
    assert.equal(windowFrame(host.hwnd)?.h, 600, 'native height');
    assert.equal(host.stats.error, 0, 'native bitmap upload');
    host.setBounds({ x: 80, y: 60, w: 1111, h: 733 });
    await until(() => host!.stats.size[0] === 1111 && host!.stats.size[1] === 733, 'resized physical bitmap');
    assert.equal(windowFrame(host.hwnd)?.w, 1111, 'resized native width');
    assert.equal(windowFrame(host.hwnd)?.h, 733, 'resized native height');

    let endSession!: () => void;
    const finished = new Promise<void>((resolve) => { endSession = resolve; });
    const stream = {
      isFinished: false,
      async send() {},
      halfClose() { this.isFinished = true; endSession(); },
      async *[Symbol.asyncIterator]() { await finished; },
    };
    card = new AssistantCard(env, async () => ({ bidi: () => stream }) as unknown as Peer, () => ({ heartbeat_ms: 4000, brain: 'mock', gate: 'rules' }));
    await card.summon();
    const w = card.window()!;
    if (w.webContents.isLoading()) await new Promise<void>((resolve) => w.webContents.once('did-finish-load', resolve));
    assert.equal(await w.webContents.executeJavaScript('document.activeElement.id'), 'text', 'first summon focuses the input after loading');
    writeFileSync(process.env.STH_DESKTOP_TEST_RESULT!, JSON.stringify({ ok: true, scale: screen.getPrimaryDisplay().scaleFactor, bitmap: host.stats.size, native: windowFrame(host.hwnd), firstSummonFocused: true }));
  } catch (e) {
    writeFileSync(process.env.STH_DESKTOP_TEST_RESULT!, JSON.stringify({ ok: false, error: String((e as Error).stack ?? e) }));
    process.exitCode = 1;
  } finally {
    card?.close();
    host?.close();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
    app.exit(Number(process.exitCode ?? 0));
  }
});
