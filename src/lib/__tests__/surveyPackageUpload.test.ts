import { describe, it, expect, vi, afterEach } from "vitest";
import JSZip from "jszip";

import { readManifestFromZip, buildCrfRows } from "@/lib/surveyPackageUpload";

/**
 * The upload path had no test of any kind before it was extracted from
 * `ProjectDetail.tsx`. It is reachable now because reading a zip needs no DOM:
 * JSZip runs in vitest's default node environment, and a test can build a
 * package in memory and read it straight back.
 *
 * The case that matters most is the last one. `crfs` is optional on the
 * manifest, and the check that it exists used to sit in a different function
 * from the loop that iterates it -- so a manifest that failed to parse
 * typechecked fine and threw at runtime. These assert that the check and the
 * use cannot be separated again without a test going red.
 */

const MANIFEST = "survey_manifest.gistx";

/** A package as an ArrayBuffer. The browser hands the real code a `File`;
 *  Node's `Blob` is not a type JSZip recognises, so tests use the buffer. */
async function zipOf(entries: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<survey>
  <question>
    <fieldname>hhnum</fieldname>
    <type>text</type>
    <text>Household number</text>
  </question>
</survey>`;

function manifest(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    surveyId: "prism_css_2026",
    surveyName: "PRISM CSS",
    databaseName: "prism_css.sqlite",
    crfs: [{ tablename: "hh_info", displayname: "Household", isbase: 1 }],
    ...extra,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readManifestFromZip", () => {
  it("reads the manifest and returns the surveyId", async () => {
    const file = await zipOf({ [MANIFEST]: manifest(), "hh_info.xml": XML });

    const { manifest: parsed, surveyId } = await readManifestFromZip(file);

    expect(surveyId).toBe("prism_css_2026");
    expect(parsed.databaseName).toBe("prism_css.sqlite");
    expect(parsed.crfs).toHaveLength(1);
  });

  it("finds the manifest when the zip has a folder prefix", async () => {
    // The app's own packages are flat, but a zip made by right-clicking a
    // folder nests everything one level down. Matching is on the suffix.
    const file = await zipOf({ [`package/${MANIFEST}`]: manifest() });

    await expect(readManifestFromZip(file)).resolves.toMatchObject({
      surveyId: "prism_css_2026",
    });
  });

  it("refuses a zip with no manifest", async () => {
    const file = await zipOf({ "hh_info.xml": XML });

    await expect(readManifestFromZip(file)).rejects.toThrow(
      "Invalid ZIP: survey_manifest.gistx is missing.",
    );
  });

  it("refuses a manifest that is not JSON", async () => {
    const file = await zipOf({ [MANIFEST]: "not json at all" });

    await expect(readManifestFromZip(file)).rejects.toThrow();
  });

  it("refuses a manifest with no crfs key", async () => {
    const file = await zipOf({
      [MANIFEST]: JSON.stringify({ surveyId: "s", databaseName: "d.sqlite" }),
    });

    await expect(readManifestFromZip(file)).rejects.toThrow(
      "Invalid Manifest: 'crfs' array is missing or empty.",
    );
  });

  it("refuses a manifest whose crfs array is empty", async () => {
    const file = await zipOf({ [MANIFEST]: manifest({ crfs: [] }) });

    await expect(readManifestFromZip(file)).rejects.toThrow(
      "Invalid Manifest: 'crfs' array is missing or empty.",
    );
  });

  it("refuses a manifest whose crfs is not an array", async () => {
    const file = await zipOf({ [MANIFEST]: manifest({ crfs: { a: 1 } }) });

    await expect(readManifestFromZip(file)).rejects.toThrow(
      "Invalid Manifest: 'crfs' array is missing or empty.",
    );
  });

  it("refuses a manifest with no surveyId", async () => {
    const file = await zipOf({ [MANIFEST]: manifest({ surveyId: undefined }) });

    await expect(readManifestFromZip(file)).rejects.toThrow(
      "Invalid Manifest: 'surveyId' is required.",
    );
  });
});

describe("buildCrfRows", () => {
  it("builds one row per crfs entry, carrying the ids it was given", async () => {
    const file = await zipOf({ [MANIFEST]: manifest(), "hh_info.xml": XML });
    const { zip, manifest: parsed } = await readManifestFromZip(file);

    const rows = await buildCrfRows({
      zip,
      manifest: parsed,
      surveyPackageId: "pkg-1",
      projectId: "proj-1",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      survey_package_id: "pkg-1",
      project_id: "proj-1",
      table_name: "hh_info",
      display_name: "Household",
      is_base: true,
    });
  });

  it("applies the documented defaults for absent optional fields", async () => {
    const file = await zipOf({ [MANIFEST]: manifest(), "hh_info.xml": XML });
    const { zip, manifest: parsed } = await readManifestFromZip(file);

    const [row] = await buildCrfRows({
      zip,
      manifest: parsed,
      surveyPackageId: "pkg-1",
      projectId: "proj-1",
    });

    expect(row.display_order).toBe(0);
    expect(row.primary_key).toBeNull();
    expect(row.linking_field).toBeNull();
    expect(row.parent_table).toBeNull();
    expect(row.auto_start_repeat).toBe(0);
    // Not 0: the default enforce mode is 1, and a 0 here would silently mean
    // "any number of children is acceptable".
    expect(row.repeat_enforce_count).toBe(1);
  });

  it("nests _formConfig inside an existing idconfig rather than replacing it", async () => {
    const file = await zipOf({
      [MANIFEST]: manifest({
        crfs: [
          {
            tablename: "hh_info",
            idconfig: { prefix: "GX", incrementLength: 3 },
            incrementfield: "linenum",
          },
        ],
      }),
      "hh_info.xml": XML,
    });
    const { zip, manifest: parsed } = await readManifestFromZip(file);

    const [row] = await buildCrfRows({
      zip,
      manifest: parsed,
      surveyPackageId: "pkg-1",
      projectId: "proj-1",
    });

    const idConfig = row.id_config as Record<string, unknown>;
    expect(idConfig.prefix).toBe("GX");
    expect(idConfig.incrementLength).toBe(3);
    expect(idConfig._formConfig).toMatchObject({ incrementField: "linenum" });
  });

  it("skips a form whose xml is missing from the zip, and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Manifest names hh_info, but the zip carries no hh_info.xml.
    const file = await zipOf({ [MANIFEST]: manifest() });
    const { zip, manifest: parsed } = await readManifestFromZip(file);

    const rows = await buildCrfRows({
      zip,
      manifest: parsed,
      surveyPackageId: "pkg-1",
      projectId: "proj-1",
    });

    expect(rows).toEqual([]);
    expect(warn).toHaveBeenCalledWith("XML file hh_info.xml not found in ZIP.");
  });

  it("keeps the manifest's crfs order", async () => {
    const file = await zipOf({
      [MANIFEST]: manifest({
        crfs: [
          { tablename: "hh_info" },
          { tablename: "hh_members" },
          { tablename: "nets" },
        ],
      }),
      "hh_info.xml": XML,
      "hh_members.xml": XML,
      "nets.xml": XML,
    });
    const { zip, manifest: parsed } = await readManifestFromZip(file);

    const rows = await buildCrfRows({
      zip,
      manifest: parsed,
      surveyPackageId: "pkg-1",
      projectId: "proj-1",
    });

    expect(rows.map((r) => r.table_name)).toEqual([
      "hh_info",
      "hh_members",
      "nets",
    ]);
  });
});
