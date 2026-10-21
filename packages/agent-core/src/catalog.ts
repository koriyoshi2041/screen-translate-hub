// The v1 catalog of local services and how to start them (spec 18 section 2).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceSpec } from './supervisor.ts';

export interface TranslatorConfig {
  /** Registered name, e.g. translate.claude-cli. */
  name: string;
  engine: 'claude-cli' | 'openai' | 'anthropic' | 'bergamot' | 'mock';
  [k: string]: unknown;
}

export interface CatalogOptions {
  root: string;
  node?: string;
  python?: string;
  translators: TranslatorConfig[];
  /** Replay frames instead of capturing the screen (headless tests). */
  replay?: { dir: string; interval_ms: number };
  /** Process ids whose windows the follow-active-window mode must skip. */
  excludePids?: number[];
  viewer?: { port: number; host: string; access_token: string };
  assistant?: Record<string, unknown>;
}

export function pythonPath(root: string): string {
  const venv = join(root, '.venv', 'Scripts', 'python.exe');
  return existsSync(venv) ? venv : 'python';
}

export function catalog(o: CatalogOptions): ServiceSpec[] {
  const node = o.node ?? process.execPath;
  const py = o.python ?? pythonPath(o.root);
  const pyCwd = join(o.root, 'services', 'py');
  const ts = (rel: string) => [join(o.root, rel)];
  const specs: ServiceSpec[] = [
    {
      name: 'capture',
      command: py,
      args: ['-X', 'utf8', '-m', 'capture.service'],
      cwd: pyCwd,
      config: { ...(o.replay ? { replay: o.replay } : {}), exclude_pids: o.excludePids ?? [] },
    },
    { name: 'ocr.rapidocr', command: py, args: ['-X', 'utf8', '-m', 'ocr.service'], cwd: pyCwd },
    { name: 'normalize', command: node, args: ts('services/normalize/src/main.ts'), cwd: o.root },
    { name: 'coordinator', command: node, args: ts('services/coordinator/src/main.ts'), cwd: o.root },
  ];
  for (const t of o.translators) {
    const { name, ...config } = t;
    specs.push({ name, command: node, args: ts('services/translate/src/main.ts'), cwd: o.root, config });
  }
  if (o.viewer) specs.push({ name: 'viewer', command: node, args: ts('services/viewer/src/main.ts'), cwd: o.root, config: o.viewer });
  if (o.assistant) specs.push({ name: 'assistant', command: node, args: ts('services/assistant/src/main.ts'), cwd: o.root, config: o.assistant });
  return specs;
}
