// Settings of this computer (spec 12 section 5), stored in %APPDATA%\screen-translate-hub.
import type { TranslatorConfig } from '@sth/agent-core';
import { defaultSettings, type DisplaySettings } from '@sth/render';
import { addSource, continuousTemplate, screenshotTemplate, validate, type WorkflowDoc } from '@sth/workflow';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Settings {
  target_language: string;
  /** Translation sources, highest priority first; the first one is the preferred source. */
  translators: TranslatorConfig[];
  display: DisplaySettings;
  continuous: {
    range: 'display' | 'follow_active_window' | 'window_under_cursor';
    interval_ms: number;
  };
  /** LAN viewer (requirement 09 section 3.4); host 0.0.0.0 listens on every network, 127.0.0.1 only on this computer. */
  viewer: { enabled: boolean; host: string; port: number; access_token: string };
  sharing: boolean;
  hotkeys: Record<string, string>;
  assistant: {
    brain: 'claude-code' | 'pi';
    model: string;
    pi_provider?: string;
    pi_api_key?: string;
    heartbeat_ms: number;
    gate: 'rules' | 'jev' | 'composite';
    jev_api_key?: string;
  };
}

export const DEFAULT_HOTKEYS: Record<string, string> = {
  screenshot: 'Alt+Shift+S',
  continuous: 'Alt+Shift+C',
  overlay: 'Alt+Shift+H',
  interactive: 'Alt+Shift+I',
  assistant: 'Alt+Shift+A',
};

/** 12 characters a phone user can type: 60 bits, with the viewer locking out repeated failures. */
export function newAccessCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
  const bytes = randomBytes(12);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export function defaults(): Settings {
  return {
    target_language: 'zh-Hans',
    // preferred first: the AI translation replaces the faster offline one (william's old app)
    translators: [
      { name: 'translate.claude-cli', engine: 'claude-cli', model: 'haiku', warm: 2 },
      { name: 'translate.bergamot', engine: 'bergamot' },
    ],
    display: defaultSettings('overlay'),
    continuous: { range: 'display', interval_ms: 700 },
    viewer: { enabled: true, host: '0.0.0.0', port: 8848, access_token: newAccessCode() },
    sharing: false,
    hotkeys: { ...DEFAULT_HOTKEYS },
    assistant: { brain: 'claude-code', model: 'haiku', heartbeat_ms: 4000, gate: 'rules' },
  };
}

export class SettingsStore {
  readonly dir: string;
  private readonly file: string;
  value: Settings;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'settings.json');
    const base = defaults();
    if (existsSync(this.file)) {
      try {
        this.value = merge(base, JSON.parse(readFileSync(this.file, 'utf8')) as Patch<Settings>);
      } catch {
        this.value = base;
      }
    } else {
      this.value = base;
    }
    this.save();
  }

  save(): void {
    writeFileSync(this.file, JSON.stringify(this.value, null, 2));
  }

  update(patch: Patch<Settings>): Settings {
    const next = merge(this.value, patch);
    validateSettings(next);
    this.value = next;
    this.save();
    return this.value;
  }
}

export type Patch<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? Patch<T[K]> : T[K] };

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Nested objects merge key by key; arrays and other values replace. */
function merge<T>(base: T, patch: Patch<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? merge(out[k], v) : v;
  }
  return out as T;
}

/**
 * Workflows for the two v1 entries, built from the default templates: the last
 * configured translator is the template's local source (bundled.translate), the
 * others are added above it in the configured order (spec 03 section 8).
 */
export function workflows(s: Settings, dir?: string, onProblem?: (file: string, problem: string) => void): { screenshot: WorkflowDoc; continuous: WorkflowDoc } {
  const built = defaultWorkflows(s);
  if (!dir) return built;
  // requirement 09 section 2: without the node editor, a workflow can be supplied as a JSON file
  // (workflows/screenshot.json, workflows/continuous.json); an invalid file falls back to the default
  for (const entry of ['screenshot', 'continuous'] as const) {
    const file = join(dir, 'workflows', `${entry}.json`);
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as WorkflowDoc;
      if (!Array.isArray(doc?.nodes) || !Array.isArray(doc?.edges)) {
        onProblem?.(file, 'not a workflow document: "nodes" and "edges" lists are required');
        continue;
      }
      const problems = validate(doc);
      if (doc.entry !== entry) problems.push({ rule: 0, message: `entry is ${doc.entry}, expected ${entry}` });
      if (problems.length) onProblem?.(file, problems.map((p) => p.message).join('; '));
      else built[entry] = doc;
    } catch (err) {
      onProblem?.(file, (err as Error).message);
    }
  }
  return built;
}

function defaultWorkflows(s: Settings): { screenshot: WorkflowDoc; continuous: WorkflowDoc } {
  const build = (doc: WorkflowDoc): WorkflowDoc => {
    let d = doc;
    const extra = s.translators.slice(0, -1);
    extra.forEach((t, i) => {
      d = addSource(d, `src_${i + 1}`, t.name, i + 1, { mode: t.mode ?? 'stream' });
    });
    if (doc.entry === 'continuous') {
      const screen = d.nodes.find((n) => n.type === 'screen_input');
      if (screen) screen.params = { ...screen.params, trigger: { interval_ms: s.continuous.interval_ms } };
    }
    return d;
  };
  return { screenshot: build(screenshotTemplate(s.target_language)), continuous: build(continuousTemplate(s.target_language)) };
}

/** Validate before touching the saved configuration or restarting services. */
export function validateSettings(s: Settings): void {
  if (!s || typeof s.target_language !== 'string' || !s.target_language.trim()) throw new Error('Choose a target language.');
  if (!Array.isArray(s.translators) || s.translators.length === 0) throw new Error('Configure at least one translation source.');
  const names = new Set<string>();
  for (const t of s.translators) {
    if (!t || typeof t.name !== 'string' || !t.name.trim() || !['claude-cli','openai','anthropic','bergamot','mock'].includes(t.engine)) throw new Error('Each source needs a name and a supported engine.');
    if (names.has(t.name)) throw new Error(`Translation source names must be unique: ${t.name}`);
    names.add(t.name);
  }
  const number = (name: string, value: number, min: number, max: number) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  };
  number('Capture interval', s.continuous?.interval_ms, 100, 60000);
  number('Heartbeat interval', s.assistant?.heartbeat_ms, 1000, 3600000);
  number('Viewer port', s.viewer?.port, 1, 65535);
  if (!Number.isInteger(s.viewer.port)) throw new Error('Viewer port must be an integer.');
  number('Plate opacity', s.display?.plate_opacity, 0, 1);
  number('Brightness', s.display?.brightness, 0, 1);
  number('Font scale', s.display?.font_scale, 0.5, 3);
  number('Minimum font size', s.display?.min_font_px, 6, 40);
  if (!['plate','dim'].includes(s.display.mode) || !['inplace','card'].includes(s.display.screenshot_placement)) throw new Error('Choose a supported display mode and screenshot placement.');
  if (typeof s.viewer.access_token !== 'string' || !s.viewer.access_token.trim()) throw new Error('Set a viewer access code.');
}
