import { describe, expect, it } from 'vitest';
import { sampleHouse } from './domain/model';
import { checkFileMeta, MAX_IMPORT_BYTES, MAX_IMPORT_ELEMENTS, parseImportBytes, projectFile, readImportFile } from './importFile';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const errorOf = (r: ReturnType<typeof parseImportBytes>) => (r.ok ? null : r.error);

describe('checkFileMeta', () => {
  it('accepts .json up to exactly 1 MB with an empty or JSON MIME type', () => {
    expect(checkFileMeta('house.formwise.json', MAX_IMPORT_BYTES, '')).toBeNull();
    expect(checkFileMeta('HOUSE.JSON', 10, 'application/json')).toBeNull();
  });

  it('rejects files over 1 MB, empty files, other extensions and non-JSON types', () => {
    expect(checkFileMeta('a.json', MAX_IMPORT_BYTES + 1, '')).toMatch(/is 1,048,577 bytes; the limit is 1 MB \(1,048,576 bytes\)/);
    expect(checkFileMeta('a.json', 0, '')).toMatch(/empty/);
    expect(checkFileMeta('a.txt', 10, 'text/plain')).toMatch(/not a \.json file/);
    expect(checkFileMeta('a.json.zip', 10, 'application/zip')).toMatch(/not a \.json file/);
    expect(checkFileMeta('a.json', 10, 'image/png')).toMatch(/has type image\/png/);
  });
});

describe('parseImportBytes', () => {
  it('round-trips a project file', () => {
    const m = sampleHouse();
    const r = parseImportBytes(bytes(projectFile(m)));
    expect(r).toMatchObject({ ok: true, format: 'formwise', issues: 0 });
    expect(r.ok && r.model).toEqual(m);
  });

  it('rejects invalid UTF-8, invalid JSON and non-objects', () => {
    expect(errorOf(parseImportBytes(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]).buffer))).toMatch(/not valid UTF-8/);
    expect(errorOf(parseImportBytes(bytes('{"format":')))).toMatch(/not valid JSON/);
    expect(errorOf(parseImportBytes(bytes('[1,2]')))).toMatch(/JSON object/);
  });

  it('rejects unknown formats and versions', () => {
    expect(errorOf(parseImportBytes(bytes('{"name":"x"}')))).toMatch(/expected a Formwise project/);
    const v2 = JSON.parse(projectFile(sampleHouse()));
    v2.version = 2;
    expect(errorOf(parseImportBytes(bytes(JSON.stringify(v2))))).toMatch(/version 2 is not supported/);
  });

  it('rejects malformed models: bad types and unknown storeys', () => {
    const f = JSON.parse(projectFile(sampleHouse()));
    f.model.elements['WN-01'].width = '1.2';
    expect(errorOf(parseImportBytes(bytes(JSON.stringify(f))))).toMatch(/malformed/);
    const g = JSON.parse(projectFile(sampleHouse()));
    g.model.elements['WN-01'].storeyId = 'XX';
    expect(errorOf(parseImportBytes(bytes(JSON.stringify(g))))).toMatch(/malformed/);
  });

  it('rejects empty and oversized element sets', () => {
    const f = JSON.parse(projectFile(sampleHouse()));
    f.model.elements = {};
    expect(errorOf(parseImportBytes(bytes(JSON.stringify(f))))).toMatch(/no building elements/);
    const slab = f.model.elements;
    for (let i = 0; i <= MAX_IMPORT_ELEMENTS; i++) slab[`S${i}`] = { id: `S${i}`, type: 'slab', storeyId: 'EG', name: 's', thickness: 0.2, uValue: 1 };
    expect(errorOf(parseImportBytes(bytes(JSON.stringify(f))))).toMatch(/2001 elements; the limit is 2000/);
  });

  it('imports a model with geometry issues but reports how many', () => {
    const f = JSON.parse(projectFile(sampleHouse()));
    f.model.elements['WN-02'].width = 3;
    expect(parseImportBytes(bytes(JSON.stringify(f)))).toMatchObject({ ok: true, issues: 1 });
  });
});

describe('readImportFile', () => {
  it('checks size before reading the contents', async () => {
    const big = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'big.json', { type: 'application/json' });
    expect(await readImportFile(big)).toEqual({ ok: false, error: expect.stringMatching(/the limit is 1 MB/) });
    const ok = new File([projectFile(sampleHouse())], 'house.formwise.json', { type: 'application/json' });
    expect(await readImportFile(ok)).toMatchObject({ ok: true });
  });
});
