import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readCsv, readSpreadsheet, readXlsx, writeXlsx } from './spreadsheet';
import { extractDamage, extractTreatmentKey, guessDamageMapping, guessTreatmentKeyMapping } from './importers';

describe('xlsx round trip', () => {
  it('writes and reads back values', () => {
    const bytes = writeXlsx([
      {
        name: 'Damage',
        rows: [
          ['Image', '% Damage', 'Treatment'],
          ['BRS24-01_4x_1_T_P', 12.5, 'Control'],
          ['BRS24-01_4x_1_T_M1', 3, 'Control'],
          ['Weird & <name>', null, true],
        ],
      },
      { name: 'Treatment key', rows: [['Bioreactor', 'Treatment'], ['BRS24-01', 'Control']] },
    ]);
    const sheets = readXlsx(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Damage', 'Treatment key']);
    expect(sheets[0].rows[1][0].v).toBe('BRS24-01_4x_1_T_P');
    expect(sheets[0].rows[1][1].v).toBe(12.5);
    expect(sheets[0].rows[3][0].v).toBe('Weird & <name>');
    expect(sheets[0].rows[3][2].v).toBe(true);
  });

  it('reads shared strings, rich text, prefixed namespaces and percent formats', () => {
    const files = {
      '[Content_Types].xml': strToU8('<Types/>'),
      '_rels/.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>',
      ),
      'xl/workbook.xml': strToU8(
        '<x:workbook xmlns:x="urn:x" xmlns:r="urn:r"><x:sheets><x:sheet name="Data" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId7" Type="http://x/worksheet" Target="worksheets/data.xml"/><Relationship Id="rId8" Type="http://x/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId9" Type="http://x/styles" Target="styles.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<x:sst><x:si><x:t>Image</x:t></x:si><x:si><x:r><x:t>BRS24-</x:t></x:r><x:r><x:t>10_4x_2_T_M2</x:t></x:r><x:rPh><x:t>IGNORED</x:t></x:rPh></x:si></x:sst>',
      ),
      'xl/styles.xml': strToU8(
        '<styleSheet><numFmts><numFmt numFmtId="170" formatCode="0.0%"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="170"/><xf numFmtId="10"/></cellXfs></styleSheet>',
      ),
      'xl/worksheets/data.xml': strToU8(
        '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c></x:row><x:row r="3"><x:c r="A3" t="s"><x:v>1</x:v></x:c><x:c r="C3" s="1"><x:v>0.125</x:v></x:c><x:c r="D3" t="str"><x:f>A3</x:f><x:v>formula text</x:v></x:c></x:row></x:sheetData></x:worksheet>',
      ),
    };
    const sheets = readXlsx(zipSync(files));
    expect(sheets[0].name).toBe('Data');
    expect(sheets[0].rows[0][0].v).toBe('Image');
    expect(sheets[0].rows[2][0].v).toBe('BRS24-10_4x_2_T_M2');
    expect(sheets[0].rows[2][2]).toEqual({ v: 0.125, pct: true });
    expect(sheets[0].rows[2][3].v).toBe('formula text');
    expect(sheets[0].rows[1]).toEqual([]);
  });

  it('rejects legacy .xls with a helpful message', () => {
    const fake = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => readSpreadsheet('old.xls', fake)).toThrow(/save it as \.xlsx/);
  });
});

describe('csv', () => {
  it('parses quotes, semicolons and percents', () => {
    const s = readCsv('Image;Damage\n"BRS1_4x_1_T_P";12,5\nBRS1_4x_1_T_D;"7%"\n');
    expect(s.rows[1][0].v).toBe('BRS1_4x_1_T_P');
    expect(s.rows[1][1].v).toBe(12.5);
    expect(s.rows[2][1]).toEqual({ v: 0.07, pct: true });
  });
});

describe('damage sheet detection', () => {
  it('finds the name, damage and treatment columns', () => {
    const sheets = [
      readCsv(
        [
          'Study export,,,',
          'Row,Image name,Treatment,% Damage',
          '1,BRS24-01_4x_1_T_P,Control,4.2',
          '2,BRS24-01_4x_1_B_P,Control,5',
          '3,BRS24-02_4x_1_T_P,New device,12',
          '4,BRS24-02_4x_1_T_D,New device,n/a',
        ].join('\n'),
      ),
    ];
    const m = guessDamageMapping(sheets);
    expect(m.nameCol).toBe(1);
    expect(m.damageCol).toBe(3);
    expect(m.treatmentCol).toBe(2);
    expect(m.headerRow).toBe(1);
    const res = extractDamage(sheets, m);
    expect(res.rows).toHaveLength(3);
    expect(res.rows[2]).toMatchObject({ damage: 12, treatment: 'New device', key: 'brs24-02_4x_1_t_p' });
    expect(res.skipped[0].reason).toMatch(/isn't a number/);
    expect(res.ambiguousUnits).toBe(false);
  });

  it('converts percent-formatted fractions', () => {
    const sheets = [readCsv('Image,Damage\nBRS1_4x_1_T_P,12.5%\nBRS1_4x_1_T_D,3%')];
    const m = guessDamageMapping(sheets);
    expect(m.units).toBe('fraction');
    const res = extractDamage(sheets, m);
    expect(res.rows.map((r) => +r.damage.toFixed(6))).toEqual([12.5, 3]);
  });

  it('flags values that might be fractions', () => {
    const sheets = [readCsv('Image,Damage\nBRS1_4x_1_T_P,0.12\nBRS1_4x_1_T_D,0.3')];
    const res = extractDamage(sheets, guessDamageMapping(sheets));
    expect(res.ambiguousUnits).toBe(true);
  });

  it('reads a treatment key sheet', () => {
    const sheets = [readCsv('Treatment,Bioreactor\nControl,BRS24-01\nDevice A,brs24-02\n')];
    const m = guessTreatmentKeyMapping(sheets, ['BRS24-01', 'BRS24-02']);
    expect(m.vesselCol).toBe(1);
    expect(m.treatmentCol).toBe(0);
    expect(extractTreatmentKey(sheets, m)).toEqual([
      { vessel: 'BRS24-01', treatment: 'Control' },
      { vessel: 'brs24-02', treatment: 'Device A' },
    ]);
  });
});
