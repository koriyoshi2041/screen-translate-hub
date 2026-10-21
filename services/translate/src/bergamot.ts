// Bergamot (Firefox Translations) running as WebAssembly. Filled in by the
// bergamot milestone; until then the engine reports itself unavailable.
import type { ServiceManifest } from '@sth/model';
import { RpcError } from '@sth/wire';
import type { Emit, TranslateEngine, TranslateRequest } from './engine.ts';

export class BergamotEngine implements TranslateEngine {
  readonly id = 'bergamot';

  static async create(_config: Record<string, unknown>): Promise<BergamotEngine> {
    return new BergamotEngine();
  }

  manifest(name: string): ServiceManifest {
    return {
      name,
      display_name: 'Bergamot (offline)',
      interfaces: [{ name: 'translate', major: 1, minor: 0 }],
      engine: { id: 'bergamot', name: 'Bergamot', version: '0' },
      languages: { source: ['en', 'zh-Hans'], target: ['en', 'zh-Hans'], detects_source: false },
      platform: { os: 'any', arch: 'any', accelerators: ['cpu'] },
      limits: { max_concurrency: 1, requests_per_second: 20, burst: 5, max_units_per_request: 16, max_chars_per_request: 4000 },
      streaming: false,
      metering: 'none',
    };
  }

  async translate(_req: TranslateRequest, _emit: Emit, _signal: AbortSignal): Promise<void> {
    throw new RpcError('unavailable', 'bergamot engine not installed yet');
  }
}
