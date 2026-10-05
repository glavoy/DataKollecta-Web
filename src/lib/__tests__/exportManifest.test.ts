import { describe, it, expect } from 'vitest';
import { buildExportManifest } from '../exportManifest';
import JSZip from 'jszip';
const context = { exportId: 'export-1', createdAt: '2026-10-05T09:00:00Z', projectId: 'project-1', scope: 'survey-1' };

describe('export integrity manifest', () => {
  it('matches a standard SHA-256 vector and includes UTF-8 byte length', async () => {
    const result = await buildExportManifest({ 'data.csv': 'abc' }, context);
    expect(result.files[0]).toEqual({ path: 'data.csv', bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
  });
  it('verifies exact bytes recovered from the downloaded ZIP, including BOM and Unicode', async () => {
    const files = { 'data.csv': '\uFEFFid,name\r\n1,Élodie\r\n', 'empty.csv': '\uFEFFid\r\n' };
    const manifest = await buildExportManifest(files, context);
    const zip = new JSZip();
    for (const [name, value] of Object.entries(files)) zip.file(name, value);
    const downloaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
    for (const file of manifest.files) {
      const bytes = await downloaded.file(file.path)!.async('uint8array');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      expect(bytes.byteLength).toBe(file.bytes);
      expect(Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')).toBe(file.sha256);
    }
  });
  it('changes the checksum when a clinical value changes and orders filenames deterministically', async () => {
    const before = await buildExportManifest({ 'z.csv': 'x', 'a.csv': '1' }, context);
    const after = await buildExportManifest({ 'a.csv': '2', 'z.csv': 'x' }, context);
    expect(before.files.map(f => f.path)).toEqual(['a.csv', 'z.csv']);
    expect(after.files[0].sha256).not.toBe(before.files[0].sha256);
    expect(after.files[1].sha256).toBe(before.files[1].sha256);
  });
});
