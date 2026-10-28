// Settings page. Saving applies display settings and hotkeys immediately;
// translator or viewer changes restart those services.
import { sth } from './bridge.ts';

type Settings = Record<string, any>;

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const PRESETS: Record<string, Record<string, unknown>> = {
  claude: { name: 'translate.claude-cli', engine: 'claude-cli', model: 'haiku', warm: 2 },
  openai: { name: 'translate.openai', engine: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-5-mini', api_key: '' },
  anthropic: { name: 'translate.anthropic', engine: 'anthropic', model: 'claude-haiku-5-5', api_key: '' },
  bergamot: { name: 'translate.bergamot', engine: 'bergamot' },
  mock: { name: 'translate.mock', engine: 'mock', prefix: '[mock] ', latency_ms: 200 },
};

let s: Settings;

function fill(): void {
  $<HTMLSelectElement>('target_language').value = s.target_language;
  $<HTMLTextAreaElement>('translators').value = JSON.stringify(s.translators, null, 2);
  for (const k of ['mode', 'plate_opacity', 'brightness', 'font_scale', 'min_font_px', 'screenshot_placement']) $(k).value = String(s.display[k]);
  $('range').value = s.continuous.range;
  $('interval_ms').value = String(s.continuous.interval_ms);
  $('viewer_enabled').checked = s.viewer.enabled;
  $('viewer_port').value = String(s.viewer.port);
  $('viewer_token').value = s.viewer.access_token;
  $('viewer_local').checked = s.viewer.host === '127.0.0.1';
  $('sharing').checked = s.sharing;
  const hk = $<HTMLFieldSetElement>('hotkeys');
  hk.innerHTML = '';
  for (const [name, accel] of Object.entries(s.hotkeys)) {
    const l = document.createElement('label');
    l.textContent = name;
    const i = document.createElement('input');
    i.type = 'text';
    i.value = String(accel);
    i.dataset.hotkey = name;
    l.appendChild(i);
    hk.appendChild(l);
  }
  $('brain').value = s.assistant.brain;
  $('assistant_model').value = s.assistant.model;
  $('pi_provider').value = s.assistant.pi_provider ?? '';
  $('pi_api_key').value = s.assistant.pi_api_key ?? '';
  $('heartbeat_ms').value = String(s.assistant.heartbeat_ms);
  $('gate').value = s.assistant.gate;
  $('jev_api_key').value = s.assistant.jev_api_key ?? '';
}

function collect(): Settings {
  const translators = sourceList();
  const hotkeys: Record<string, string> = {};
  for (const i of document.querySelectorAll<HTMLInputElement>('input[data-hotkey]')) hotkeys[i.dataset.hotkey!] = i.value.trim();
  return {
    target_language: $<HTMLSelectElement>('target_language').value,
    translators,
    display: {
      ...s.display,
      mode: $('mode').value,
      plate_opacity: Number($('plate_opacity').value),
      brightness: Number($('brightness').value),
      font_scale: Number($('font_scale').value),
      min_font_px: Number($('min_font_px').value),
      screenshot_placement: $('screenshot_placement').value,
    },
    continuous: { range: $('range').value, interval_ms: Number($('interval_ms').value) },
    viewer: {
      enabled: $('viewer_enabled').checked,
      host: $('viewer_local').checked ? '127.0.0.1' : '0.0.0.0',
      port: Number($('viewer_port').value),
      access_token: $('viewer_token').value,
    },
    sharing: $('sharing').checked,
    hotkeys,
    assistant: {
      brain: $('brain').value,
      model: $('assistant_model').value,
      pi_provider: $('pi_provider').value || undefined,
      pi_api_key: $('pi_api_key').value || undefined,
      heartbeat_ms: Number($('heartbeat_ms').value),
      gate: $('gate').value,
      jev_api_key: $('jev_api_key').value || undefined,
    },
  };
}

function message(text: string, state: 'info' | 'error' | 'success'): void {
  $('msg').textContent = text;
  $('msg').dataset.state = state;
}

function sourceList(): Array<Record<string, unknown>> {
  let value: unknown;
  try { value = JSON.parse($<HTMLTextAreaElement>('translators').value.trim() || '[]'); }
  catch { throw new Error('Translation sources must be valid JSON. Check the brackets, commas, and quotes.'); }
  if (!Array.isArray(value)) throw new Error('Translation sources must be a JSON list, inside [ and ].');
  return value;
}

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-add]')) {
  b.addEventListener('click', () => {
    try {
      const list = sourceList();
      const preset = PRESETS[b.dataset.add!];
      if (list.some(source => source?.name === preset.name)) {
        message(`${b.textContent!.replace(/^\+\s*/, '')} is already configured. You can edit its entry in Translation sources.`, 'info');
        return;
      }
      list.unshift({ ...preset });
      $<HTMLTextAreaElement>('translators').value = JSON.stringify(list, null, 2);
      message('Source added. Select Save to apply your changes.', 'info');
    } catch (e) {
      message((e as Error).message, 'error');
      $('translators').focus();
    }
  });
}

document.querySelector('main')!.addEventListener('input', () => message('Unsaved changes. Select Save to apply.', 'info'));

$('save').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('save');
  button.disabled = true;
  button.textContent = 'Saving…';
  document.querySelector('main')!.inert = true;
  try {
    s = (await sth.invoke({ kind: 'save-settings', patch: collect() })) as Settings;
    fill();
    message('Saved.', 'success');
  } catch (e) {
    const problem = (e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    message(`Not saved: ${problem}`, 'error');
  } finally {
    document.querySelector('main')!.inert = false;
    button.disabled = false;
    button.textContent = 'Save';
  }
});

void sth.invoke({ kind: 'get-settings' }).then((v) => {
  s = v as Settings;
  fill();
});
