import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Direction, OcrResult, Quad, TextBlock, Unit } from '@sth/model';
import { joinLines, normalize } from '../src/normalize.ts';

function quad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

let nextBlock = 1;
function blk(text: string, x: number, y: number, w: number, h: number, direction?: Direction): TextBlock {
  return { block_id: nextBlock++, text, quad: quad(x, y, w, h), direction };
}

function ocr(blocks: TextBlock[], rect = { x: 0, y: 0, w: 2000, h: 2000 }, scale = 1): OcrResult {
  return { run_id: 'r', batch_seq: 1, regions: [{ rect, scale, blocks, engine: 'test' }] };
}

function run(blocks: TextBlock[], reused: Unit[] = [], firstId = 1): Unit[] {
  return normalize({ ocr: ocr(blocks), reused, first_id: firstId, frame_width: 2000, frame_height: 2000 });
}

test('two columns: left column first, same-height lines stay apart', () => {
  const units = run([
    blk('Right column first line of the text', 1050, 100, 800, 20),
    blk('Left column first line of the text', 100, 100, 800, 20),
    blk('continues on the second line here.', 100, 126, 600, 20),
    blk('and the right one continues too.', 1050, 126, 620, 20),
  ]);
  assert.equal(units.length, 2);
  assert.match(units[0].text, /^Left column.*here\.$/);
  assert.match(units[1].text, /^Right column.*too\.$/);
  assert.deepEqual(units.map((u) => u.order), [1, 2]);
  assert.equal(units[0].lines?.length, 2);
});

test('fragments of one line are joined, boxes kept', () => {
  const units = run([blk('world', 160, 100, 60, 20), blk('Hello', 100, 100, 55, 20)]);
  assert.equal(units.length, 1);
  assert.equal(units[0].text, 'Hello world');
  assert.equal(units[0].lines?.length, 2);
});

test('hyphenation and CJK joining (spec 06 section 7)', () => {
  assert.equal(joinLines('an exam-', 'ple text'), 'an example text');
  assert.equal(joinLines('这是一个', '段落'), '这是一个段落');
  assert.equal(joinLines('한국어', '문장'), '한국어 문장');
  assert.equal(joinLines('Hello', 'World'), 'Hello World');
});

test('sentence end on a short line ends the paragraph (condition 6)', () => {
  const units = run([
    blk('A long first line of a paragraph that spans the column', 100, 100, 900, 20),
    blk('and ends here.', 100, 126, 200, 20),
    blk('The next paragraph starts right below without a gap', 100, 152, 880, 20),
  ]);
  assert.equal(units.length, 2);
});

test('stacked menu labels are not merged (v1 rule)', () => {
  const units = run([
    blk('Open', 100, 100, 60, 20),
    blk('Save', 100, 126, 60, 20),
    blk('Close window', 100, 152, 140, 20),
  ]);
  assert.equal(units.length, 3);
});

test('vertical Japanese columns read right to left, bubbles separate', () => {
  const units = run([
    // bubble A on the right: two columns
    blk('こんにちは', 900, 100, 30, 150, 'ttb'),
    blk('げんきですか', 862, 100, 30, 170, 'ttb'),
    // bubble B on the left, far away
    blk('はい', 400, 100, 30, 60, 'ttb'),
  ]);
  assert.equal(units.length, 2);
  assert.equal(units[0].text, 'こんにちはげんきですか');
  assert.equal(units[0].direction, 'ttb');
  assert.equal(units[1].text, 'はい');
});

test('region coordinates are mapped back with offset and scale', () => {
  const units = normalize({
    ocr: ocr([blk('Scaled', 20, 10, 100, 40)], { x: 500, y: 300, w: 100, h: 50 }, 2),
    reused: [],
    first_id: 1,
    frame_width: 2000,
    frame_height: 2000,
  });
  assert.deepEqual(units[0].bounds, { x: 510, y: 305, w: 50, h: 20 });
});

test('reused paragraphs are atomic and keep their ids; new ones start at first_id', () => {
  const reused: Unit = {
    paragraph_id: 1,
    order: 0,
    text: 'Kept paragraph',
    direction: 'ltr',
    bounds: { x: 100, y: 100, w: 300, h: 20 },
    lines: [blk('Kept paragraph', 100, 100, 300, 20)],
    origin: 'reused',
  };
  const units = run([blk('New text below', 100, 400, 300, 20)], [reused], 2);
  assert.equal(units.length, 2);
  assert.equal(units[0].paragraph_id, 1);
  assert.equal(units[0].origin, 'reused');
  assert.equal(units[1].paragraph_id, 2);
  assert.deepEqual(units.map((u) => u.order), [1, 2]);
});

test('Arabic is inferred as right to left', () => {
  const ar = String.fromCharCode(0x645, 0x631, 0x62d, 0x628, 0x627);
  const units = run([blk(ar, 100, 100, 200, 20)]);
  assert.equal(units[0].direction, 'rtl');
});
