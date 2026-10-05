/** Integrity metadata covers exact UTF-8 file bytes, including a CSV BOM. */
export interface ExportManifest {
  format_version: 1;
  export_id: string;
  created_at: string;
  project_id: string;
  scope: string;
  consistency: 'Live reads; hashes identify exported bytes. A reviewed locked snapshot is required for endorsement.';
  files: { path: string; bytes: number; sha256: string }[];
}

export async function buildExportManifest(
  files: Readonly<Record<string, string>>,
  context: { exportId: string; createdAt: string; projectId: string; scope: string },
): Promise<ExportManifest> {
  const entries = await Promise.all(Object.keys(files).sort().map(async (path) => {
    const bytes = new TextEncoder().encode(files[path]);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return {
      path,
      bytes: bytes.byteLength,
      sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''),
    };
  }));
  return {
    format_version: 1,
    export_id: context.exportId,
    created_at: context.createdAt,
    project_id: context.projectId,
    scope: context.scope,
    consistency: 'Live reads; hashes identify exported bytes. A reviewed locked snapshot is required for endorsement.',
    files: entries,
  };
}
