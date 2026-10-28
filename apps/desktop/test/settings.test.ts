import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SettingsStore } from '../src/main/settings.ts';

test('invalid editable settings leave both the running and saved configuration intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sth-settings-test-'));
  try {
    const store = new SettingsStore(dir);
    const saved = readFileSync(join(dir, 'settings.json'), 'utf8');
    for (const patch of [{translators:[]}, {translators:[store.value.translators[0],store.value.translators[0]]}, {viewer:{port:70000}}, {display:{font_scale:0}}, {continuous:{interval_ms:0}}]) {
      assert.throws(() => store.update(patch));
      assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), saved);
    }
    store.update({ sharing:true, display:{mode:'dim',brightness:0.3} });
    assert.equal(store.value.sharing,true);
    assert.equal(new SettingsStore(dir).value.display.mode,'dim');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
