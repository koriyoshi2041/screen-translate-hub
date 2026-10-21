// Spec 06 section 6: merge consecutive lines of a leaf into paragraphs.
import type { Direction, Unit } from '@sth/model';
import { endsWithContinuation, endsWithSentencePunct } from './join.ts';
import { isVertical, type Line } from './lines.ts';
import type { OrderItem } from './order.ts';
import type { NormalizeParams } from './params.ts';

export type Piece = { kind: 'line'; line: Line } | { kind: 'reused'; unit: Unit };

export type Paragraph = { kind: 'new'; lines: Line[] } | { kind: 'reused'; unit: Unit };

function extent(l: Line): number {
  return isVertical(l.dir) ? l.box.h : l.box.w;
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function shouldMerge(a: Line, b: Line, colWidth: number, p: NormalizeParams): boolean {
  if (a.dir !== b.dir) return false; // 2
  const ratio = Math.max(a.glyph, b.glyph) / Math.max(1e-6, Math.min(a.glyph, b.glyph));
  if (ratio > p.kh) return false; // 3
  const v = isVertical(a.dir);
  const h = Math.min(a.glyph, b.glyph);
  const dist = v ? a.box.x - (b.box.x + b.box.w) : b.box.y - (a.box.y + a.box.h);
  if (dist < -p.kv * h || dist > p.kg * h) return false; // 4
  const ov = v
    ? overlap1d(a.box.y, a.box.y + a.box.h, b.box.y, b.box.y + b.box.h)
    : overlap1d(a.box.x, a.box.x + a.box.w, b.box.x, b.box.x + b.box.w);
  if (ov < p.ko * Math.min(extent(a), extent(b))) return false; // 5
  if (endsWithSentencePunct(a.text) && extent(a) < p.ks * colWidth) return false; // 6
  // v1 addition: stacked short labels of a Latin UI (menus, lists) are separate units.
  const short = (l: Line) => extent(l) < p.shortLine * colWidth || l.text.trim().split(/\s+/).length <= 4;
  if (!v && short(a) && short(b)) {
    const aligned = a.dir === 'rtl' ? Math.abs(a.box.x + a.box.w - (b.box.x + b.box.w)) < 0.5 * h : Math.abs(a.box.x - b.box.x) < 0.5 * h;
    if (aligned && /^[A-Z]/.test(b.text.trimStart()) && !endsWithContinuation(a.text)) return false;
  }
  return true;
}

export function mergeParagraphs(leaf: OrderItem<Piece>[], p: NormalizeParams): Paragraph[] {
  const lines = leaf.flatMap((it) => (it.ref.kind === 'line' ? [it.ref.line] : []));
  const colWidth = Math.max(1, ...lines.map(extent));
  const out: Paragraph[] = [];
  let current: Line[] | null = null;
  for (const it of leaf) {
    if (it.ref.kind === 'reused') {
      current = null; // 1: reused paragraphs never merge
      out.push({ kind: 'reused', unit: it.ref.unit });
      continue;
    }
    const line = it.ref.line;
    if (current && shouldMerge(current[current.length - 1], line, colWidth, p)) {
      current.push(line);
    } else {
      current = [line];
      out.push({ kind: 'new', lines: current });
    }
  }
  return out;
}

export function majorityDir(lines: Line[]): Direction {
  const w = new Map<Direction, number>();
  for (const l of lines) w.set(l.dir, (w.get(l.dir) ?? 0) + l.box.w * l.box.h);
  return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ltr';
}
