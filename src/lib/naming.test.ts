import { describe, expect, it } from 'vitest';
import {
  formatImageName,
  nameKey,
  parseImageName,
  positionSlot,
  positionsForSection,
  stripExtension,
} from './naming';

describe('parseImageName', () => {
  it('parses the README example', () => {
    const r = parseImageName('BRS24-10_4x_2_T_M2');
    expect(r).toEqual({
      ok: true,
      value: {
        bioreactor: 'BRS24-10',
        magnification: '4x',
        section: 2,
        side: 'T',
        position: 'M2',
        suffix: '',
        overlay: false,
      },
    });
  });

  it('handles extensions, case and spaces', () => {
    const r = parseImageName('brs24-10 4X 3 b p.TIF');
    expect(r.ok && r.value).toMatchObject({ bioreactor: 'brs24-10', magnification: '4x', section: 3, side: 'B', position: 'P' });
    const r2 = parseImageName('BRS24-01_10x_1_Top_Distal.ome.tiff');
    expect(r2.ok && r2.value).toMatchObject({ magnification: '10x', side: 'T', position: 'D' });
  });

  it('reads a bare M as M1 and spelled-out positions', () => {
    expect(parseImageName('BRS1_4x_1_T_M').ok && (parseImageName('BRS1_4x_1_T_M') as any).value.position).toBe('M1');
    expect((parseImageName('BRS1_4x_1_T_Med3') as any).value.position).toBe('M3');
    expect((parseImageName('BRS1_4x_S4_B_prox') as any).value).toMatchObject({ section: 4, position: 'P' });
  });

  it('keeps suffixes and recognises traced overlays', () => {
    const r = parseImageName('BRS24-10_4x_2_T_M2_trace.png');
    expect(r.ok && r.value).toMatchObject({ suffix: 'trace', overlay: true, position: 'M2' });
    const r2 = parseImageName('BRS24-10_4x_2_T_M2_2.jpg');
    expect(r2.ok && r2.value).toMatchObject({ suffix: '2', overlay: false });
  });

  it('understands spelled-out sections', () => {
    const r = parseImageName('BRS24-12 section 2 bottom distal.tif');
    expect(r.ok && r.value).toMatchObject({ bioreactor: 'BRS24-12', section: 2, side: 'B', position: 'D', magnification: null });
    const r2 = parseImageName('BRS24-12_4x_Sec_3_T_M1');
    expect(r2.ok && r2.value).toMatchObject({ bioreactor: 'BRS24-12', section: 3 });
  });

  it('supports bioreactor IDs containing underscores', () => {
    const r = parseImageName('LAB_BRS24-10_4x_2_T_D');
    expect(r.ok && r.value.bioreactor).toBe('LAB_BRS24-10');
  });

  it('works without a magnification', () => {
    const r = parseImageName('BRS24-10_2_T_M1');
    expect(r.ok && r.value).toMatchObject({ bioreactor: 'BRS24-10', magnification: null, section: 2 });
  });

  it('explains what is wrong', () => {
    const bad = parseImageName('BRS24-10_4x_2_X_M2');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/isn't a side/);
    const bad2 = parseImageName('BRS24-10_4x_2_T_Q');
    expect(!bad2.ok && bad2.error).toMatch(/isn't a position/);
    const bad3 = parseImageName('IMG_0042.jpg');
    expect(bad3.ok).toBe(false);
    const bad4 = parseImageName('BRS24-10_4x_two_T_M2');
    expect(!bad4.ok && bad4.error).toMatch(/section number/);
  });
});

describe('helpers', () => {
  it('strips extensions and builds match keys', () => {
    expect(stripExtension('a_b.tif')).toBe('a_b');
    expect(stripExtension('BRS24-10_4x_2_T_M2')).toBe('BRS24-10_4x_2_T_M2');
    expect(nameKey(' BRS24-10_4x_2_T_M2.TIF ')).toBe('brs24-10_4x_2_t_m2');
    expect(nameKey('BRS24-10 4x 2 T M2')).toBe('brs24-10_4x_2_t_m2');
  });

  it('orders positions along a section', () => {
    expect(positionsForSection(2)).toEqual(['P', 'M1', 'M2', 'D']);
    expect(positionSlot('P', 2)).toBe(0);
    expect(positionSlot('M2', 2)).toBe(2);
    expect(positionSlot('D', 2)).toBe(3);
    expect(positionSlot('D', 1)).toBe(2);
  });

  it('round-trips names', () => {
    const name = formatImageName({ bioreactor: 'BRS24-03', magnification: '4x', section: 4, side: 'B', position: 'D' });
    expect(name).toBe('BRS24-03_4x_4_B_D');
    expect(parseImageName(name).ok).toBe(true);
  });
});
