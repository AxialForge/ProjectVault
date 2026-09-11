// Export a project as a self-contained zip: every file (latest versions at the
// top, older ones under _versions/), the thumbnails, and a project.json with
// all catalogue data so it can be read without ProjectVault.
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

async function exportProject(lib, projectId, dest, { includeVersions = true, includeThumbs = true, onProgress } = {}) {
  const project = lib.getProject(projectId);
  if (!project) throw new Error("project not found");
  const items = lib.listItems(projectId);
  const zip = new JSZip();
  const root = zip.folder(project.name);
  const manifest = {
    exported: new Date().toISOString(),
    app: "ProjectVault",
    project: { ...project },
    items: [],
    history: lib.history(projectId, 5000),
  };
  let total = 0;
  for (const it of items) total += includeVersions ? it.versions.length : 1;
  let n = 0;
  for (const it of items) {
    const versions = includeVersions ? it.versions : it.versions.slice(0, 1);
    const rec = { ...it, versions: [] };
    for (const v of versions) {
      const abs = lib.abs(v.relpath);
      const inZip = v.version_no === it.versions[0].version_no ? it.name : path.join("_versions", `v${v.version_no}`, v.filename);
      if (fs.existsSync(abs)) root.file(inZip.replace(/\\/g, "/"), fs.createReadStream(abs));
      const vr = { ...v, zip_path: inZip };
      if (includeThumbs && v.thumb) {
        const t = path.join(lib.thumbDir, v.thumb);
        if (fs.existsSync(t)) {
          const tp = `_thumbs/${v.thumb}`;
          root.file(tp, fs.createReadStream(t));
          vr.thumb_zip_path = tp;
        }
      }
      rec.versions.push(vr);
      n++;
      if (onProgress) onProgress({ done: n, total, current: v.filename });
    }
    manifest.items.push(rec);
  }
  root.file("project.json", JSON.stringify(manifest, null, 2));
  root.file("README.txt", readme(project, items));
  await new Promise((resolve, reject) => {
    zip
      .generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } })
      .pipe(fs.createWriteStream(dest))
      .on("finish", resolve)
      .on("error", reject);
  });
  return { files: n, dest };
}

function readme(p, items) {
  const lines = [
    `${p.name}`,
    "=".repeat(p.name.length),
    "",
    p.description || "",
    "",
    `Category: ${p.category || "(none)"}`,
    `Status: ${p.status}   Progress: ${p.progress}%`,
    `Tags: ${(p.tags || []).join(", ") || "(none)"}`,
    "",
    "Files",
    "-----",
  ];
  for (const it of items) lines.push(`${it.name}  (${it.versions.length} version${it.versions.length === 1 ? "" : "s"})${it.notes ? "  - " + it.notes.replace(/\s+/g, " ") : ""}`);
  lines.push("", "Notes", "-----", p.notes || "(none)", "", "Exported from ProjectVault. project.json holds the full catalogue data.");
  return lines.join("\n");
}

module.exports = { exportProject };
