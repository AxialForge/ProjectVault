// One-way mirror of the library to the NAS. Local is master.
//
// Rules:
//   * New or changed local files (size or mtime differ) are copied to the NAS.
//   * The NAS never loses a file silently. A file deleted locally stays on the
//     NAS until the deletion (which always carries a reason) is processed: the
//     NAS copy is then MOVED to <nas>/_Deleted/<timestamp>/ and the reason is
//     appended to <nas>/_Deleted/deletions.log. Nothing is ever hard-deleted.
//   * Files on the NAS that the local library doesn't know about are left alone.
//   * The database file and thumbnail cache are mirrored too, so the NAS copy
//     is a complete, restorable library.
const fs = require("node:fs/promises");
const path = require("node:path");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, base, skip, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (skip.some((s) => rel === s || rel.startsWith(s + path.sep))) continue;
    if (e.isDirectory()) await walk(full, base, skip, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

async function run({ libraryPath, nasPath, deletions, onProgress, onDeletionDone }) {
  const report = { copied: 0, skipped: 0, deleted: 0, errors: [], bytes: 0, started: new Date().toISOString() };
  if (!nasPath) throw new Error("No NAS path configured");
  await fs.mkdir(nasPath, { recursive: true });
  if (!(await exists(nasPath))) throw new Error("NAS path is not reachable: " + nasPath);

  // 1. Process deletions first so a re-added file with the same name isn't lost.
  for (const d of deletions) {
    const src = path.join(nasPath, d.relpath);
    try {
      if (await exists(src)) {
        const stamp = d.ts.replace(/[:.]/g, "-");
        const dest = path.join(nasPath, "_Deleted", stamp, d.relpath);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.rename(src, dest).catch(async () => {
          await fs.copyFile(src, dest);
          await fs.unlink(src);
        });
        report.deleted++;
      }
      const log = `${d.ts}\t${d.project_name}\t${d.item_name}\t${d.relpath}\t${d.reason.replace(/\s+/g, " ")}\n`;
      await fs.mkdir(path.join(nasPath, "_Deleted"), { recursive: true });
      await fs.appendFile(path.join(nasPath, "_Deleted", "deletions.log"), log);
      await onDeletionDone(d.id);
    } catch (err) {
      report.errors.push(`delete ${d.relpath}: ${err.message}`);
    }
  }

  // 2. Mirror files.
  const files = await walk(libraryPath, libraryPath, [path.join(".drafthouse", "trash"), "drafthouse.db.tmp"], []);
  let n = 0;
  for (const rel of files) {
    n++;
    const src = path.join(libraryPath, rel);
    const dst = path.join(nasPath, rel);
    try {
      const s = await fs.stat(src);
      let same = false;
      try {
        const t = await fs.stat(dst);
        same = t.size === s.size && Math.abs(t.mtimeMs - s.mtimeMs) < 2000;
      } catch {
        /* missing */
      }
      if (same) {
        report.skipped++;
      } else {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(src, dst);
        await fs.utimes(dst, s.atime, s.mtime).catch(() => {});
        report.copied++;
        report.bytes += s.size;
      }
    } catch (err) {
      report.errors.push(`${rel}: ${err.message}`);
    }
    if (onProgress && (n % 5 === 0 || n === files.length)) onProgress({ done: n, total: files.length, current: rel });
  }
  report.finished = new Date().toISOString();
  return report;
}

module.exports = { run, exists };
