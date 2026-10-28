import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import type { spawn } from 'node:child_process';
import { test } from 'node:test';
import { ClaudeCodeBrain } from '../src/brain-claude.ts';

class Process extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  constructor() {
    super();
    this.stdin.on('data', d => {
      const m = JSON.parse(String(d));
      if (m.type === 'control_request') this.result();
    });
    this.stdin.on('finish', () => this.exit());
  }
  result() { this.stdout.write(JSON.stringify({ type: 'result', subtype: 'success' }) + '\n'); }
  exit() { if (this.exitCode === null) { this.exitCode = 0; this.emit('exit', 0); } }
  kill() { this.killed = true; this.exit(); return true; }
}

test('interrupting one Claude turn does not kill the next turn after three seconds', async () => {
  const proc = new Process();
  const brain = new ClaudeCodeBrain({ assistantUrl: 'ws://fixture', token: 'fixture', sessionId: 'fixture' }, (() => proc) as unknown as typeof spawn);
  await brain.open('', []);
  try {
    const abort = new AbortController();
    const first = brain.wake({ kind: 'user_message', text: 'first' }, abort.signal)[Symbol.asyncIterator]();
    assert.equal((await first.next()).value?.type, 'status');
    abort.abort();
    assert.deepEqual((await first.next()).value, { type: 'turn_end', stop: 'cancelled' });
    await first.next();
    const second = brain.wake({ kind: 'user_message', text: 'second' }, new AbortController().signal)[Symbol.asyncIterator]();
    await second.next();
    await sleep(3200);
    assert.equal(proc.killed, false, 'completed interruption must release its fallback timer');
    proc.result();
    assert.deepEqual((await second.next()).value, { type: 'turn_end', stop: 'done' });
    await second.next();
  } finally { await brain.close(); }
});

test('an already cancelled wake never launches Claude', async () => {
  let calls = 0;
  const brain = new ClaudeCodeBrain({ assistantUrl: '', token: '', sessionId: '' }, (() => { calls++; return new Process(); }) as unknown as typeof spawn);
  const events = [];
  for await (const e of brain.wake({ kind: 'user_message', text: 'old' }, AbortSignal.abort())) events.push(e);
  assert.equal(calls, 0);
  assert.deepEqual(events, [{ type: 'turn_end', stop: 'cancelled' }]);
});
