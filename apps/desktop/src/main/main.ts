// Desktop agent entry (spec 12 section 2): tray, hotkeys, settings, the agent
// core with its local services, and the system integration services.
import { AgentCore, catalog, RunLauncher, type RunHandle } from '@sth/agent-core';
import type { CaptureRange, Image } from '@sth/model';
import { connect, Peer } from '@sth/wire';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { CardService } from './card.ts';
import { OverlayManager, type WindowEnv } from './overlay.ts';
import { selectRegion, type PhysicalRect } from './select.ts';
import { newAccessCode, SettingsStore, workflows, type Patch, type Settings } from './settings.ts';
import * as win32 from './win32.ts';

app.setName('screen-translate-hub');
if (!app.requestSingleInstanceLock()) app.quit();
if (process.argv.includes('--no-gpu')) app.disableHardwareAcceleration();

const root = resolve(__dirname, '..', '..', '..');
const env: WindowEnv = {
  preload: join(__dirname, 'preload.cjs'),
  rendererDir: join(__dirname, 'renderer'),
  debugCapturable: process.env.STH_DEBUG_CAPTURABLE === '1' || process.argv.includes('--debug-capturable'),
  settings: () => store.value.display,
};

let store: SettingsStore;
let agent: AgentCore;
let launcher: RunLauncher;
let overlay: OverlayManager;
let cards: CardService;
let tray: Tray | null = null;
let continuous: RunHandle | null = null;
let settingsWin: BrowserWindow | null = null;

function nodePath(): string {
  for (const p of [process.env.STH_NODE, 'C:\\Program Files\\nodejs\\node.exe']) if (p && existsSync(p)) return p;
  return 'node';
}

function deviceId(dir: string): string {
  const f = join(dir, 'device-id');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  const id = randomUUID();
  writeFileSync(f, id);
  return id;
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

function defineServices(s: Settings): void {
  const local = s.translators[s.translators.length - 1]?.name ?? 'translate.claude-cli';
  agent.setAlias('bundled.ocr', 'ocr.rapidocr');
  agent.setAlias('bundled.translate', local);
  const specs = catalog({
    root,
    node: nodePath(),
    translators: s.translators,
    excludePids: [process.pid],
    viewer: s.viewer.enabled ? { port: s.viewer.port, host: s.viewer.host, access_token: s.viewer.access_token } : undefined,
  });
  for (const spec of specs) agent.define(spec);
}

/** Start the services a first screenshot needs, so it does not wait for model loading. */
function prewarm(): void {
  const names = ['capture', 'ocr.rapidocr', 'normalize', 'coordinator', ...store.value.translators.map((t) => t.name)];
  if (store.value.viewer.enabled) names.push('viewer');
  for (const n of names) void agent.waitFor(n).catch((e) => console.error(`prewarm ${n}:`, e.message));
}

async function capturePeer(): Promise<Peer> {
  const reg = await agent.waitFor('capture');
  const conn = await connect(reg.endpoint, { token: agent.token, peer: 'agent' });
  return new Peer(conn, reg.manifest.name);
}

async function grab(target: Record<string, unknown>): Promise<Image> {
  const peer = await capturePeer();
  try {
    return await peer.unary<Record<string, unknown>, Image>('capture', 'Grab', { ...target, format: 'raw_bgra8' }, { deadlineMs: 10_000 });
  } finally {
    peer.conn.close();
  }
}

// ---------------- entries ----------------

async function screenshotRegion(rect: PhysicalRect): Promise<RunHandle> {
  const image = await grab({ region: rect });
  return launcher.start(workflows(store.value).screenshot, { image, anchor: { x: rect.x, y: rect.y + rect.h + 8 } });
}

async function startScreenshot(): Promise<void> {
  cards.dismissInPlace();
  const sel = await selectRegion(env, () => grab({}));
  if (!sel) return;
  const { rect, image } = sel;
  const run = await launcher.start(workflows(store.value).screenshot, { image, anchor: { x: rect.x, y: rect.y + rect.h + 8 } });
  const st = await run.finished;
  if (st.state === 'failed') notify('Screenshot translation failed', run.preflight?.problem ?? st.reason ?? '');
}

function rangeFor(mode: Settings['continuous']['range']): { range: CaptureRange; label: string } {
  if (mode === 'follow_active_window') return { range: { follow_active_window: true }, label: 'active window' };
  if (mode === 'window_under_cursor') {
    const c = win32.cursorPos();
    const hwnd = win32.topWindowAt(c.x, c.y);
    if (hwnd && win32.windowPid(hwnd) !== process.pid) return { range: { window_id: hwnd }, label: win32.windowTitle(hwnd) || 'window' };
  }
  return { range: {}, label: 'primary display' };
}

async function startContinuous(mode = store.value.continuous.range): Promise<void> {
  if (continuous?.active) return;
  const { range, label } = rangeFor(mode);
  continuous = await launcher.start(workflows(store.value).continuous, { continuous_range: range, range_label: label });
  continuous.onStatus(() => refreshTray());
  void continuous.finished.then((st) => {
    if (st.state === 'failed') notify('Continuous translation failed', continuous?.preflight?.problem ?? st.reason ?? '');
    refreshTray();
  });
  refreshTray();
}

async function toggleContinuous(): Promise<void> {
  if (!continuous?.active) return startContinuous();
  if (continuous.status.state === 'running') await continuous.pause();
  else if (continuous.status.state === 'paused') await continuous.resume();
}

async function stopContinuous(): Promise<void> {
  if (continuous?.active) await continuous.stop();
}

// ---------------- tray, hotkeys, settings window ----------------

/** Addresses phones on the same network can open: private IPv4 first, loopback when listening only locally. */
function viewerAddresses(): string[] {
  const s = store.value.viewer;
  if (s.host === '127.0.0.1') return [`http://127.0.0.1:${s.port}`];
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) ips.push(a.address);
  }
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  ips.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
  return ips.map((ip) => `http://${ip}:${s.port}`);
}

/** The link carries the access code in the fragment, which browsers never send to the server. */
function viewerLink(): string {
  return `${viewerAddresses()[0] ?? `http://127.0.0.1:${store.value.viewer.port}`}/#k=${store.value.viewer.access_token}`;
}

async function newViewerCode(): Promise<void> {
  const code = newAccessCode();
  store.update({ viewer: { access_token: code } });
  try {
    const reg = await agent.waitFor('viewer');
    const conn = await connect(reg.endpoint, { token: agent.token, peer: 'agent' });
    try {
      await new Peer(conn, reg.manifest.name).unary('viewer', 'SetAccessToken', { access_token: code }, { deadlineMs: 5_000 });
    } finally {
      conn.close();
    }
  } catch (e) {
    console.error('viewer access code not applied:', (e as Error).message);
  }
  refreshTray();
}

function refreshTray(): void {
  if (!tray) return;
  const st = continuous?.active ? continuous.status.state : 'idle';
  const s = store.value;
  tray.setToolTip(`screen-translate-hub (${st})`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Screenshot translate\t${s.hotkeys.screenshot}`, click: () => void startScreenshot() },
      { type: 'separator' },
      { label: st === 'idle' ? 'Start continuous: primary display' : `Continuous: ${st}`, enabled: st === 'idle', click: () => void startContinuous('display') },
      { label: 'Start continuous: follow active window', enabled: st === 'idle', click: () => void startContinuous('follow_active_window') },
      { label: st === 'paused' ? 'Resume' : 'Pause', enabled: st === 'running' || st === 'paused', click: () => void toggleContinuous() },
      { label: 'Stop', enabled: st === 'running' || st === 'paused', click: () => void stopContinuous() },
      { type: 'separator' },
      { label: 'Show translations', type: 'checkbox', checked: true, click: () => overlay.toggleVisible() },
      { label: 'Interactive overlay', type: 'checkbox', checked: false, click: () => overlay.toggleInteractive() },
      { label: 'Share to LAN viewers', type: 'checkbox', checked: s.sharing, click: (i) => setSharing(i.checked) },
      ...(s.viewer.enabled
        ? [
            { label: `Viewer: ${viewerAddresses()[0] ?? 'no network'}`, enabled: false },
            { label: `Access code: ${s.viewer.access_token}`, enabled: false },
            { label: 'Copy viewer link', click: () => clipboard.writeText(viewerLink()) },
            { label: 'New access code', click: () => void newViewerCode() },
          ]
        : []),
      { type: 'separator' },
      { label: 'Settings...', click: () => openSettings() },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function setSharing(on: boolean): void {
  store.update({ sharing: on });
  agent.setSharing(on);
  refreshTray();
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll();
  const h = store.value.hotkeys;
  const bind = (accel: string | undefined, fn: () => void) => {
    if (accel && !globalShortcut.register(accel, fn)) console.error(`hotkey ${accel} is taken`);
  };
  bind(h.screenshot, () => void startScreenshot());
  bind(h.continuous, () => void toggleContinuous());
  bind(h.overlay, () => overlay.toggleVisible());
  bind(h.interactive, () => overlay.toggleInteractive());
}

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 760,
    title: 'screen-translate-hub settings',
    webPreferences: { preload: env.preload, contextIsolation: true, sandbox: false },
  });
  if (!env.debugCapturable) settingsWin.setContentProtection(true); // the main window is excluded too (spec 12 section 3.3)
  settingsWin.setMenu(null);
  void settingsWin.loadFile(join(env.rendererDir, 'settings.html'));
}

ipcMain.handle('sth', async (_e, msg: { kind: string; patch?: Patch<Settings> }) => {
  if (msg.kind === 'get-settings') return store.value;
  if (msg.kind === 'save-settings' && msg.patch) {
    const before = JSON.stringify(store.value.translators) + JSON.stringify(store.value.viewer);
    store.update(msg.patch);
    overlay.applySettings(store.value.display);
    registerHotkeys();
    refreshTray();
    if (JSON.stringify(store.value.translators) + JSON.stringify(store.value.viewer) !== before) {
      // translators or viewer changed: redefine and restart those services
      agent.supervisor.stopAll();
      defineServices(store.value);
      prewarm();
    }
    return store.value;
  }
  return null;
});

// ---------------- development control (SSH testing) ----------------

function startDevControl(): void {
  if (process.env.STH_DEV_CONTROL !== '1' && !process.argv.includes('--dev-control')) return;
  const token = randomUUID();
  const server = createServer((req, res) => {
    if (req.headers['x-sth-token'] !== token) {
      res.writeHead(403).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const a = JSON.parse(body || '{}') as Record<string, unknown>;
        let out: unknown = { ok: true };
        if (a.action === 'screenshot') {
          const run = await screenshotRegion(a.rect as PhysicalRect);
          out = { run_id: run.id, status: await run.finished, preflight: run.preflight };
        } else if (a.action === 'continuous-start') await startContinuous((a.mode as Settings['continuous']['range']) ?? 'display');
        else if (a.action === 'continuous-stop') await stopContinuous();
        else if (a.action === 'continuous-toggle') await toggleContinuous();
        else if (a.action === 'state') out = { continuous: continuous?.status ?? null, services: agent.list().map((r) => r.manifest.name), settings: store.value };
        else if (a.action === 'settings') {
          store.update(a.patch as Patch<Settings>);
          overlay.applySettings(store.value.display);
        } else if (a.action === 'details' && continuous) out = await launcher.details(continuous.id);
        else if (a.action === 'dismiss') cards.dismissInPlace();
        else if (a.action === 'open-settings') openSettings();
        else if (a.action === 'win-info') {
          const hosts = [...overlay.hosts(), ...cards.hosts()].map((h) => ({ kind: 'overlay-host', ...win32.windowInfo(h.hwnd), affinity: win32.displayAffinity(h.hwnd) }));
          const wins = BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), url: w.webContents.getURL().split('/').pop(), ...win32.windowInfo(win32.hwndOf(w.getNativeWindowHandle())) }));
          const fg = win32.foregroundWindow();
          const cursor = win32.cursorPos();
          const under = win32.topWindowAt(cursor.x, cursor.y);
          out = {
            hosts,
            windows: wins,
            foreground: { hwnd: fg, title: win32.windowTitle(fg), ...win32.windowInfo(fg) },
            cursor: { ...cursor, window: under, title: win32.windowTitle(under) },
          };
        } else if (a.action === 'desktop-shot') {
          // through our own capture service; overlays show up only with --debug-capturable
          const peer = await capturePeer();
          try {
            const img = await peer.unary<Record<string, unknown>, Image>('capture', 'Grab', { format: 'png' }, { deadlineMs: 10_000 });
            const file = join(store.dir, 'desktop-shot.png');
            writeFileSync(file, img.image.data);
            out = { file, width: img.image.width, height: img.image.height };
          } finally {
            peer.conn.close();
          }
        } else if (a.action === 'overlay-dom') {
          const pages = [];
          for (const h of [...overlay.hosts(), ...cards.hosts()]) {
            pages.push({
              bounds: h.getBounds(),
              visible: h.isVisible,
              affinity: win32.displayAffinity(h.hwnd),
              stats: h.stats,
              dom: await h.eval(`JSON.stringify({ size: [innerWidth, innerHeight], paras: [...document.querySelectorAll('.sth-para')].map((d) => d.textContent), banner: document.querySelector('.sth-banner')?.textContent })`),
            });
          }
          out = { pages };
        } else if (a.action === 'sharing') {
          setSharing(a.on === true);
        } else if (a.action === 'viewer-link') {
          out = { link: viewerLink(), addresses: viewerAddresses() };
        } else if (a.action === 'overlay-eval') {
          const h = [...overlay.hosts(), ...cards.hosts()][Number(a.index ?? 0)];
          out = { result: h ? await h.eval(String(a.js)) : null };
        } else if (a.action === 'overlay-shots') {
          // the last frame each overlay page rendered (WDA keeps them out of real captures)
          const shots = [];
          for (const h of [...overlay.hosts(), ...cards.hosts()]) {
            const img = h.frame();
            if (!img) continue;
            const file = join(store.dir, `overlay-${shots.length}.png`);
            writeFileSync(file, img.toPNG());
            const live = await h.osr.webContents.capturePage();
            const liveFile = join(store.dir, `overlay-${shots.length}-live.png`);
            writeFileSync(liveFile, live.toPNG());
            const b = h.getBounds();
            shots.push({ file, liveFile, bounds: { x: b.x, y: b.y, width: b.w, height: b.h } });
          }
          out = { shots };
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500).end(String((e as Error).stack ?? e));
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    writeFileSync(join(store.dir, 'dev-control.json'), JSON.stringify({ port, token }));
    console.log(`dev control on 127.0.0.1:${port}`);
  });
}

// ---------------- startup ----------------

app.on('window-all-closed', () => {
  // keep running in the tray
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void agent?.stop();
});

void app.whenReady().then(async () => {
  store = new SettingsStore(join(app.getPath('appData'), 'screen-translate-hub'));
  agent = new AgentCore({
    logDir: join(store.dir, 'logs'),
    hooks: { notify: (_kind, text) => notify('screen-translate-hub', text) },
  });
  defineServices(store.value);
  overlay = new OverlayManager(env);
  cards = new CardService(env, () => store.value.display.screenshot_placement);
  agent.provide('overlay', 'overlay', { Attach: overlay.attach, Annotate: overlay.annotate });
  agent.provide('card', 'card', { Open: cards.open });
  await agent.start();
  agent.setSharing(store.value.sharing);
  launcher = new RunLauncher(agent, deviceId(store.dir));
  tray = new Tray(nativeImage.createFromPath(join(__dirname, 'assets', 'tray.png')));
  refreshTray();
  registerHotkeys();
  startDevControl();
  prewarm();
  console.log(`agent at ${agent.url}; logs in ${join(store.dir, 'logs')}`);
});
