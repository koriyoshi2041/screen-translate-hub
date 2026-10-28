// Isolated Electron regression fixture: no capture, real AI, or user settings.
import assert from 'node:assert/strict';
import { app, BrowserWindow, screen } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { defaultSettings } from '@sth/render';
import type { Peer } from '@sth/wire';
import { OverlayHost, type WindowEnv } from '../src/main/host.ts';
import { cropImage, selectRegion } from '../src/main/select.ts';
import { OverlayManager } from '../src/main/overlay.ts';
import { CardService } from '../src/main/card.ts';
import { AssistantCard } from '../src/main/assistant-card.ts';
import { windowFrame } from '../src/main/win32.ts';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.env.STH_DESKTOP_TEST_DIR!, 'profile'));
const until = async (f: () => boolean | Promise<boolean>, description: string) => {
  const end = Date.now() + 15_000;
  while (!(await f())) {
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
    await host.eval("document.body.style.background='#fafafa';document.getElementById('root').textContent='Synthetic DPI fixture'");
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
    const sent: Array<Record<string, any>> = [];
    const stream = {
      isFinished: false,
      async send(m: Record<string, any>) { sent.push(m); },
      halfClose() { this.isFinished = true; endSession(); },
      async *[Symbol.asyncIterator]() { await finished; },
    };
    card = new AssistantCard(env, async () => ({ bidi: () => stream }) as unknown as Peer, () => ({ heartbeat_ms: 4000, brain: 'mock', gate: 'rules' }));
    await card.summon();
    const w = card.window()!;
    assert.equal(await w.webContents.executeJavaScript('document.activeElement.id'), 'text', 'first summon focuses the input after loading');
    await w.webContents.executeJavaScript(`(() => { const t=document.getElementById('text'); t.value='看看'; t.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',isComposing:true,bubbles:true})); })()`);
    await sleep(100);
    assert.equal(sent.filter(m => m.user_message).length, 0, 'IME confirmation must not send');
    assert.equal(await w.webContents.executeJavaScript("document.getElementById('text').value"), '看看');
    await w.webContents.executeJavaScript("document.getElementById('text').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await until(() => sent.some(m => m.user_message?.text === '看看'), 'committed Chinese input sends once');
    assert.equal(sent.filter(m => m.user_message).length, 1);
    w.webContents.send('sth', {kind:'assistant',m:{brain:{type:'text_delta',delta:'old partial'}}});
    w.webContents.send('sth', {kind:'assistant',m:{say:{mode:'replace',text:'replacement note'}}});
    w.webContents.send('sth', {kind:'assistant',m:{brain:{type:'text_delta',delta:'continued answer'}}});
    await until(async () => (await w.webContents.executeJavaScript("document.getElementById('log').textContent")).includes('continued answer'), 'text after replace remains visible');
    card.close();
    await sleep(100);

    // Closing while the service is starting, then reopening, must not attach the old session.
    let oldPeer!: (p: Peer) => void;
    let acquireCount = 0, sessionCount = 0;
    const pendingPeer = new Promise<Peer>(resolve => { oldPeer = resolve; });
    const makePeer = () => ({ bidi: () => {
      sessionCount++;
      let finish!: () => void;
      const done = new Promise<void>(r => { finish=r; });
      return { isFinished:false, async send() {}, halfClose() { this.isFinished=true;finish(); }, async *[Symbol.asyncIterator]() { await done; } };
    }, conn: { close() {} } }) as unknown as Peer;
    card = new AssistantCard(env, () => ++acquireCount === 1 ? pendingPeer : Promise.resolve(makePeer()), () => ({ heartbeat_ms:4000,brain:'mock',gate:'rules' }));
    await card.summon(); card.close();
    await card.summon();
    await until(() => sessionCount === 1, 'new session starts');
    oldPeer(makePeer()); await sleep(100);
    assert.equal(sessionCount, 1, 'closed startup must not create an orphan session');
    card.close(); await sleep(100);

    let captures = 0;
    for (let i=0;i<2;i++) await assert.rejects(selectRegion(env, async () => { captures++; throw new Error('temporary capture failure'); }), /temporary capture failure/);
    assert.equal(captures, 2, 'a failed selection can be retried');
    const cropped = cropImage({ image: {format:'raw_bgra8',width:100,height:100,data:new Uint8Array(40000)},captured_at:'',geometry:{kind:'region',display_id:'left',origin_x:-100,origin_y:0,width:100,height:100,scale:1} }, {x:-110,y:-10,w:30,h:30});
    assert.deepEqual([cropped.image.width,cropped.image.height,cropped.geometry?.origin_x,cropped.geometry?.origin_y], [20,20,-100,0]);

    const cards = new CardService(env, () => 'card');
    await cards.open({ async send() {}, async *[Symbol.asyncIterator]() { yield { start: { kind:'screenshot',run_id:'fixture',target_language:'zh-Hans',image:{ image:{format:'raw_bgra8',width:400,height:200,data:new Uint8Array(400*200*4)},geometry:{kind:'region',origin_x:100,origin_y:100,width:400,height:200,scale:1,display_id:''} } } }; } } as never);
    const floating = cards.cardWindows()[0];
    if (floating.webContents.isLoading()) await new Promise<void>(r => floating.webContents.once('did-stop-loading', r));
    await until(async () => (await floating.webContents.executeJavaScript('[document.getElementById("img").width,document.getElementById("img").height].join(",")')) === "400,200", "screenshot image delivered");
    cards.applySettings({ ...defaultSettings('overlay'), mode:'dim',brightness:0.25 });
    await sleep(100);
    assert.match(await floating.webContents.executeJavaScript("document.querySelector('.sth-dim').style.background"), /0.75/);
    await floating.webContents.executeJavaScript("document.getElementById('toggle').click()");
    assert.equal(await floating.webContents.executeJavaScript("document.getElementById('root').style.display"), 'none');
    floating.close();
    const overlays = new OverlayManager(env);
    let disconnect!: () => void;
    const disconnected = new Promise<void>(r => { disconnect=r; });
    const drawing = overlays.annotate({ async *[Symbol.asyncIterator]() { yield {set:[{id:'fixture-box',kind:'box',rect:{x:80,y:80,w:120,h:50}},{id:'fixture-highlight',kind:'highlight',color:'red',rect:{x:90,y:180,w:100,h:50}}]}; await disconnected; } } as never);
    await until(() => overlays.hosts().length === 1 && overlays.hosts()[0].stats.paints > 0, 'annotations paint');
    const annotations=overlays.hosts()[0];
    await until(async () => await annotations.eval("document.querySelectorAll('svg rect').length === 2"), 'both annotations visible');
    assert.deepEqual(await annotations.eval("(() => {const r=document.querySelectorAll('svg rect')[1];return [r.getAttribute('fill'),r.getAttribute('fill-opacity')];})()"), ['red','0.2']);
    disconnect(); await drawing;
    await until(async () => await annotations.eval("document.querySelectorAll('svg rect').length === 0"), 'disconnected session clears its annotations');
    overlays.closeAll();
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
