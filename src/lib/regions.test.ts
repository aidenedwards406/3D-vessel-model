import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTIONS, locateRegion, positionList, regionCenter, regionFor, resolveLayout } from './regions';

describe('per-section positions', () => {
  const layout = resolveLayout(
    {
      ...DEFAULT_SECTIONS,
      count: 3,
      sectionPositions: [null, { p: true, medial: 0, d: true }, { p: true, medial: 2, d: true }],
    },
    [1, 0, 0],
  );

  it('resolves auto and custom sections', () => {
    expect(layout.positions).toEqual([['P', 'M1', 'D'], ['P', 'D'], ['P', 'M1', 'M2', 'D']]);
    expect(positionList({ p: false, medial: 1, d: true })).toEqual(['M1', 'D']);
  });

  it('maps positions to regions and rejects missing ones', () => {
    expect(regionFor(2, 'T', 'D', layout)?.slot).toBe(1);
    expect(regionFor(2, 'T', 'M1', layout)).toBeNull();
    expect(regionFor(3, 'B', 'M2', layout)?.slot).toBe(2);
  });

  it('splits each section evenly among its own positions', () => {
    // Section 2 spans 1/3..2/3 of the length and has two halves: P then D.
    expect(locateRegion(0.4, 1, 0, layout)?.position).toBe('P');
    expect(locateRegion(0.6, 1, 0, layout)?.position).toBe('D');
    expect(locateRegion(0.6, -1, 0, layout)?.side).toBe('B');
    // Centre of section 2's D half is at 1/3 + 3/4 · 1/3.
    expect(regionCenter(2, 'T', 1, layout).aT).toBeCloseTo(1 / 3 + 0.75 / 3, 6);
  });

  it('never leaves a section empty', () => {
    const l = resolveLayout({ ...DEFAULT_SECTIONS, count: 1, sectionPositions: [{ p: false, medial: 0, d: false }] }, []);
    expect(l.positions[0]).toEqual(['M1']);
  });
});
