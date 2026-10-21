import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheKey, iou, orderQuad, pxRect, sameBaseLanguage, supports, type Quad } from '../src/index.ts';

test('orderQuad starts at min x+y and goes clockwise on screen', () => {
  const q = orderQuad([
    { x: 10, y: 20 },
    { x: 0, y: 20 },
    { x: 10, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.deepEqual(q, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 20 },
    { x: 0, y: 20 },
  ]);
});

test('pxRect floors and ceils, clipped to the frame', () => {
  const q: Quad = [
    { x: -1.5, y: 2.2 },
    { x: 10.1, y: 2.2 },
    { x: 10.1, y: 8.9 },
    { x: -1.5, y: 8.9 },
  ];
  assert.deepEqual(pxRect(q, 8, 100), { x: 0, y: 2, w: 8, h: 7 });
});

test('language lookup per RFC 4647 (spec 00 section 3.5)', () => {
  assert.ok(supports(['zh-Hans', 'en'], 'zh-hans-cn'));
  assert.ok(!supports(['zh-Hans-CN'], 'zh-Hans'));
  assert.ok(!supports(['zh-Hans'], 'zh'));
  assert.ok(supports(['en'], 'en-US'));
});

test('same base language (requirement 09 section 3.2)', () => {
  assert.ok(sameBaseLanguage('zh', 'zh-Hans'));
  assert.ok(sameBaseLanguage('en-US', 'en'));
  assert.ok(!sameBaseLanguage('ja', 'zh-Hans'));
  assert.ok(!sameBaseLanguage(undefined, 'en'));
});

test('cache key examples from spec 02 section 8', () => {
  assert.equal(cacheKey('Hello,\n  world '), 'Hello, world');
  assert.equal(cacheKey('你好 世界'), '你好世界');
  assert.equal(cacheKey('你好世界'), '你好世界');
  assert.equal(cacheKey('한국어 문장'), '한국어 문장');
});

test('iou', () => {
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), 1);
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }), 0);
  assert.ok(Math.abs(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 }) - 1 / 3) < 1e-9);
});
