// Screenshot card page (spec 07 section 4): the screenshot and the translation
// layer on top of it; the user can switch to the original.
import type { DisplayEvent, DisplaySnapshot, EncodedImage } from '@sth/model';
import { applyEvent, defaultSettings, emptyState, fromSnapshot, type DisplaySettings, type DisplayState } from '@sth/render';
import { DomRenderer } from '@sth/render/dom';
import { sth } from './bridge.ts';

const root = document.getElementById('root')!;
const stage = document.getElementById('stage')!;
const canvas = document.getElementById('img') as HTMLCanvasElement;
const toggle = document.getElementById('toggle')!;
let settings: DisplaySettings = { ...defaultSettings('card'), mode: 'plate' };
let state: DisplayState = emptyState();
let target = 'zh-Hans';
let showTranslation = true;
const renderer = new DomRenderer(root, settings);

function draw(): void {
  root.style.display = showTranslation ? 'block' : 'none';
  renderer.render(state, { width: stage.clientWidth, height: stage.clientHeight, targetLanguage: target });
}

function paint(img: EncodedImage): void {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(img.width, img.height);
  const src = img.data;
  for (let i = 0; i < src.length; i += 4) {
    data.data[i] = src[i + 2];
    data.data[i + 1] = src[i + 1];
    data.data[i + 2] = src[i];
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
}

sth.on((msg) => {
  if (msg.kind === 'settings') {
    settings = { ...(msg.settings as DisplaySettings), mode: 'plate' };
    renderer.setSettings(settings);
  } else if (msg.kind === 'view') target = String(msg.target_language);
  else if (msg.kind === 'image') paint(msg.image as EncodedImage);
  else if (msg.kind === 'snapshot') state = fromSnapshot(msg.snapshot as DisplaySnapshot);
  else if (msg.kind === 'event') applyEvent(state, msg.event as DisplayEvent);
  draw();
});

toggle.addEventListener('click', () => {
  showTranslation = !showTranslation;
  toggle.textContent = showTranslation ? 'Original' : 'Translation';
  draw();
});
document.getElementById('close')!.addEventListener('click', () => window.close());
window.addEventListener('resize', draw);
