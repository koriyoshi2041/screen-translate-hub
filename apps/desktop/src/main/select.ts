// Region selection (spec 09 section 5): the display is captured first and shown
// frozen in an opaque full-screen window; the user drags a rectangle on it and the
// result is cropped from that capture, i.e. the screen at the moment selection began.
import type { Image } from '@sth/model';
import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import type { WindowEnv } from './host.ts';

export interface PhysicalRect { x: number; y: number; w: number; h: number }

export interface Selection {
  rect: PhysicalRect;
  image: Image;
}

let active: Promise<Selection | null> | null = null;

export function cropImage(img: Image, r: PhysicalRect): Image {
  const src = img.image;
  const g = img.geometry!;
  const x0 = Math.max(0, Math.round(r.x - g.origin_x));
  const y0 = Math.max(0, Math.round(r.y - g.origin_y));
  const w = Math.min(src.width, Math.round(r.x - g.origin_x + r.w)) - x0;
  const h = Math.min(src.height, Math.round(r.y - g.origin_y + r.h)) - y0;
  if (w <= 0 || h <= 0) throw new Error('The selection is outside the captured display');
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * src.width + x0) * 4;
    out.set(src.data.subarray(from, from + w * 4), y * w * 4);
  }
  return {
    image: { format: 'raw_bgra8', width: w, height: h, data: out },
    geometry: { kind: 'region', display_id: g.display_id, origin_x: g.origin_x + x0, origin_y: g.origin_y + y0, scale: g.scale, width: w, height: h },
    captured_at: img.captured_at,
  };
}

export function selectRegion(env: WindowEnv, grabDisplay: (rect: PhysicalRect) => Promise<Image>): Promise<Selection | null> {
  if (active) return active;
  active = (async () => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const b = screen.dipToScreenRect(null, display.bounds);
    const frozen = await grabDisplay({ x: b.x, y: b.y, w: b.width, h: b.height });
    return new Promise<Selection | null>((resolve) => {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: '#000000',
        show: false,
        webPreferences: { preload: env.preload, contextIsolation: true, sandbox: false },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      if (!env.debugCapturable) win.setContentProtection(true);
      let done = false;
      const finish = (r: Selection | null) => {
        if (done) return;
        done = true;
        ipcMain.removeListener('sth', onMsg);
        if (!win.isDestroyed()) win.close();
        active = null;
        resolve(r);
      };
      const onMsg = (e: Electron.IpcMainEvent, msg: { kind?: string; rect?: PhysicalRect }) => {
        if (e.sender !== win.webContents) return;
        if (msg.kind === 'select-cancel') finish(null);
        if (msg.kind === 'select-done' && msg.rect && msg.rect.w >= 4 && msg.rect.h >= 4) {
          const b = win.getBounds();
          const p = screen.dipToScreenRect(win, { x: b.x + msg.rect.x, y: b.y + msg.rect.y, width: msg.rect.w, height: msg.rect.h });
          const rect = { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) };
          finish({ rect, image: cropImage(frozen, rect) });
        }
      };
      ipcMain.on('sth', onMsg);
      win.on('closed', () => finish(null));
      void win.loadFile(join(env.rendererDir, 'select.html'));
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('sth', { kind: 'frozen', image: frozen.image });
        win.show();
        win.focus();
      });
    });
  })().finally(() => { active = null; });
  return active;
}
