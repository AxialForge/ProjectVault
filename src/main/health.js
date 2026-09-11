// Library health check: catalogue vs disk. Read-only; reports, never repairs.
const fs = require("node:fs");
const path = require("node:path");

function walk(dir, base, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (rel === ".projectvault" || rel.startsWith(".projectvault" + path.sep) || rel.startsWith("projectvault.db")) continue;
    if (e.isDirectory()) walk(full, base, out);
    else out.push(rel);
  }
  return out;
}

function check(lib) {
  const versions = lib.db.all("SELECT v.id, v.relpath, v.thumb, v.pending, v.size, i.name AS item, i.project_id FROM versions v JOIN items i ON i.id=v.item_id");
  const projects = lib.db.all("SELECT id, name, folder FROM projects");
  const known = new Set(versions.map((v) => v.relpath.toLowerCase()));
  const missing = [], badThumb = [];
  let bytes = 0;
  for (const v of versions) {
    const p = lib.abs(v.relpath);
    if (!fs.existsSync(p)) missing.push({ item: v.item, relpath: v.relpath });
    else bytes += fs.statSync(p).size;
    if (v.thumb && !fs.existsSync(path.join(lib.thumbDir, v.thumb))) badThumb.push(v.relpath);
  }
  const onDisk = walk(lib.root, lib.root, []);
  const orphans = onDisk.filter((r) => !known.has(r.toLowerCase()));
  const missingFolders = projects.filter((p) => !fs.existsSync(lib.abs(p.folder))).map((p) => p.name);
  const pending = versions.filter((v) => v.pending).length;
  const noPreview = versions.filter((v) => !v.thumb && !v.pending).length;
  let dbSize = 0, thumbs = 0, thumbBytes = 0, trashBytes = 0;
  try {
    dbSize = fs.statSync(lib.db.file).size;
  } catch {}
  try {
    for (const f of fs.readdirSync(lib.thumbDir)) {
      thumbs++;
      thumbBytes += fs.statSync(path.join(lib.thumbDir, f)).size;
    }
  } catch {}
  for (const rel of walk(path.join(lib.root, ".projectvault", "trash"), lib.root, [])) {
    try {
      trashBytes += fs.statSync(lib.abs(rel)).size;
    } catch {}
  }
  const deletionsPending = lib.pendingDeletions().length;
  const ok = !missing.length && !missingFolders.length && !badThumb.length;
  return { ok, projects: projects.length, versions: versions.length, bytes, dbSize, thumbs, thumbBytes, trashBytes, pending, noPreview, deletionsPending, missing, missingFolders, badThumb, orphans: orphans.slice(0, 200), orphanCount: orphans.length };
}

module.exports = { check };
