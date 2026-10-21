// Settings of this computer (spec 12 section 5), stored in %APPDATA%\screen-translate-hub.
import type { TranslatorConfig } from '@sth/agent-core';
import { defaultSettings, type DisplaySettings } from '@sth/render';
import { addSource, continuousTemplate, screenshotTemplate, type WorkflowDoc } from '@sth/workflow';
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
  viewer: { enabled: boolean; port: number; access_token: string };
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

export function defaults(): Settings {
  return {
    target_language: 'zh-Hans',
    translators: [{ name: 'translate.claude-cli', engine: 'claude-cli', model: 'haiku', warm: 2 }],
    display: defaultSettings('overlay'),
    continuous: { range: 'display', interval_ms: 700 },
    viewer: { enabled: true, port: 8848, access_token: randomBytes(6).toString('hex') },
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
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>;
        this.value = {
          ...base,
          ...saved,
          display: { ...base.display, ...(saved.display ?? {}) },
          continuous: { ...base.continuous, ...(saved.continuous ?? {}) },
          viewer: { ...base.viewer, ...(saved.viewer ?? {}) },
          hotkeys: { ...base.hotkeys, ...(saved.hotkeys ?? {}) },
          assistant: { ...base.assistant, ...(saved.assistant ?? {}) },
        };
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

  update(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch };
    this.save();
    return this.value;
  }
}

/**
 * Workflows for the two v1 entries, built from the default templates: the last
 * configured translator is the template's local source (bundled.translate), the
 * others are added above it in the configured order (spec 03 section 8).
 */
export function workflows(s: Settings): { screenshot: WorkflowDoc; continuous: WorkflowDoc } {
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
