import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Clients } from '@sth/service-kit';
import type { Image } from '@sth/model';
import { Platform } from '../src/platform.ts';

function fixture() {
  const messages: any[] = [];
  const grabs: any[] = [];
  const image: Image = { image: { format: 'raw_bgra8', width: 800, height: 600, data: new Uint8Array() }, captured_at: '', geometry: { kind: 'window', window_id: 42, display_id: '', origin_x: 3, origin_y: 4, scale: 1, width: 800, height: 600 } };
  const stream = { isFinished: false, send: async (m: unknown) => { messages.push(m); }, halfClose() { this.isFinished = true; } };
  const peer = { unary: async (_iface: string, method: string, req: any) => {
    if (method === 'Grab') { grabs.push(req); return image; }
    if (method === 'Recognize') return { regions: [] };
    if (method === 'Normalize') return { units: [{ paragraph_id: 1, text: 'Hello', bounds: { x: 100, y: 50, w: 200, h: 30 } }] };
    if (method === 'GetDisplay') return { snapshot: { geometry: image.geometry, held: [], paragraphs: [{ paragraph: { text: 'Hello', bounds: { x: .125, y: 1/12, w: .25, h: .05 } }, shown: { show: 'text', text: '你好' } }] } };
  } };
  const clients = { acquire: async () => ({}), peer: async () => peer, agentService: () => ({ open: () => stream }) } as unknown as Clients;
  let pid = 1;
  const windows = { foreground: async () => ({ hwnd: 42, pid, app: 'fixture', title: '' }), frame: async () => ({ x: -1200, y: 300, w: 800, h: 600 }) };
  return { clients, windows, messages, grabs, image, ownFocus: () => { pid = 99; } };
}

test('assistant window capture, OCR, and translations map to physical screen coordinates', async () => {
  const f = fixture();
  const p = new Platform(f.clients, { window_id: 42 }, [], f.windows);
  const image = await p.grab();
  assert.equal(image.geometry?.origin_x, -1197);
  assert.equal(image.geometry?.origin_y, 304);
  const paragraphs = await p.read(image);
  assert.deepEqual(paragraphs[0].rect, { x: -1097, y: 354, w: 200, h: 30 });
  assert.deepEqual((await p.translations())?.[0].rect, paragraphs[0].rect);
  await p.close();
});

test('follow mode retains the user window while the assistant input has focus', async () => {
  const f = fixture();
  const p = new Platform(f.clients, { follow_active_window: true }, [99], f.windows);
  await p.grab(); f.ownFocus(); await p.grab();
  assert.deepEqual(f.grabs.map(g => g.window_id), [42, 42]);
  await p.close();
});

test('annotation ids are separate across sessions and closed sessions cannot draw', async () => {
  const f = fixture();
  const a = new Platform(f.clients, {}, []), b = new Platform(f.clients, {}, []);
  const [x] = await a.annotate([{ kind: 'box', rect: { x: 10, y: 20, w: 30, h: 40 } }]);
  const [y] = await b.annotate([{ kind: 'label', text: 'test', point: { x: 20, y: 20 } }]);
  assert.notEqual(x, y);
  await a.clearAnnotations();
  assert.deepEqual(f.messages.at(-1), { clear: { ids: [x] } });
  await a.close();
  await assert.rejects(a.annotate([{ kind: 'box' }]), /closed/);
  await b.close();
});
