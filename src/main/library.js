// The library: a folder the app owns, a SQLite catalogue inside it, and the
// operations that keep the two in step. Every file the user adds is COPIED in
// (never linked), so the library folder is self-contained and mirrorable.
//
// Disk layout
//   <Library>/
//     drafthouse.db                      catalogue
//     .drafthouse/thumbs/<versionId>.png cached previews
//     .drafthouse/trash/<stamp>/...      deleted files (kept, never purged here)
//     <Category>/<Project>/<file>        latest version of every file
//     <Category>/<Project>/_versions/<itemId>/v<N>/<file>   superseded versions
//
// Files keep their original names at the top of the project folder, because
// CAD assemblies find their parts by filename in the same directory.
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Database } = require("./db");
const extract = require("./extract");

const STATUSES = ["idea", "planning", "in-progress", "on-hold", "done", "archived"];

function now() {
  return new Date().toISOString();
}
function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim().replace(/\.+$/, "") || "Untitled";
}
function j(v) {
  return JSON.stringify(v);
}
function parseRow(r) {
  if (!r) return r;
  const o = { ...r };
  for (const k of ["tags", "fields", "meta", "options"]) if (typeof o[k] === "string") {
    try {
      o[k] = JSON.parse(o[k]);
    } catch {
      o[k] = k === "fields" || k === "meta" ? {} : [];
    }
  }
  return o;
}

async function hashFile(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha1");
    fss.createReadStream(p).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

class Library {
  static async open(root) {
    await fs.mkdir(path.join(root, ".drafthouse", "thumbs"), { recursive: true });
    await fs.mkdir(path.join(root, ".drafthouse", "trash"), { recursive: true });
    const db = await Database.open(root);
    return new Library(root, db);
  }

  constructor(root, db) {
    this.root = root;
    this.db = db;
    this.thumbDir = path.join(root, ".drafthouse", "thumbs");
  }

  close() {
    this.db.close();
  }

  abs(rel) {
    return path.join(this.root, rel);
  }

  log(action, detail, projectId = null, itemId = null) {
    this.db.run("INSERT INTO changelog(ts,project_id,item_id,action,detail) VALUES(?,?,?,?,?)", [now(), projectId, itemId, action, detail]);
  }

  // ── projects ──────────────────────────────────────────────────
  listProjects() {
    const rows = this.db.all(
      `SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id) AS item_count,
        (SELECT v.thumb FROM versions v JOIN items i ON i.id=v.item_id WHERE i.project_id=p.id AND v.thumb!='' ORDER BY v.added DESC LIMIT 1) AS cover
       FROM projects p ORDER BY p.category, p.name COLLATE NOCASE`
    );
    return rows.map(parseRow);
  }

  getProject(id) {
    return parseRow(this.db.get("SELECT * FROM projects WHERE id=?", [id]));
  }

  async createProject({ name, category = "", status = "idea", description = "" }) {
    name = safeName(name);
    category = category.split(/[\\/]/).map(safeName).filter((s) => s !== "Untitled").join(path.sep);
    let folder = category ? path.join(category, name) : name;
    let n = 2;
    while (this.db.get("SELECT id FROM projects WHERE folder=?", [folder]) || fss.existsSync(this.abs(folder))) {
      folder = (category ? path.join(category, name) : name) + ` (${n++})`;
    }
    await fs.mkdir(this.abs(folder), { recursive: true });
    const t = now();
    this.db.run("INSERT INTO projects(name,folder,category,status,description,created,updated) VALUES(?,?,?,?,?,?,?)", [name, folder, category, status, description, t, t]);
    const id = this.db.lastId();
    this.log("project.create", name, id);
    return this.getProject(id);
  }

  updateProject(id, patch) {
    const allowed = ["name", "category", "status", "progress", "description", "notes", "tags", "fields"];
    const sets = [], vals = [];
    for (const k of allowed) {
      if (!(k in patch)) continue;
      let v = patch[k];
      if (k === "tags" || k === "fields") v = j(v);
      if (k === "name") v = safeName(v);
      if (k === "status" && !STATUSES.includes(v)) continue;
      if (k === "progress") v = Math.max(0, Math.min(100, Number(v) || 0));
      sets.push(`${k}=?`);
      vals.push(v);
    }
    if (!sets.length) return this.getProject(id);
    sets.push("updated=?");
    vals.push(now(), id);
    this.db.run(`UPDATE projects SET ${sets.join(",")} WHERE id=?`, vals);
    if ("status" in patch) this.log("project.status", patch.status, id);
    return this.getProject(id);
  }

  // ── items & versions ──────────────────────────────────────────
  listItems(projectId) {
    const items = this.db.all("SELECT * FROM items WHERE project_id=? ORDER BY name COLLATE NOCASE", [projectId]).map(parseRow);
    for (const it of items) it.versions = this.listVersions(it.id);
    return items;
  }

  listVersions(itemId) {
    return this.db.all("SELECT * FROM versions WHERE item_id=? ORDER BY version_no DESC", [itemId]).map(parseRow);
  }

  getItem(id) {
    const it = parseRow(this.db.get("SELECT * FROM items WHERE id=?", [id]));
    if (it) it.versions = this.listVersions(id);
    return it;
  }

  getVersion(id) {
    return parseRow(this.db.get("SELECT * FROM versions WHERE id=?", [id]));
  }

  updateItem(id, patch) {
    const sets = [], vals = [];
    for (const k of ["name", "kind", "notes", "tags", "fields"]) {
      if (!(k in patch)) continue;
      let v = patch[k];
      if (k === "tags" || k === "fields") v = j(v);
      sets.push(`${k}=?`);
      vals.push(v);
    }
    if (!sets.length) return this.getItem(id);
    sets.push("updated=?");
    vals.push(now(), id);
    this.db.run(`UPDATE items SET ${sets.join(",")} WHERE id=?`, vals);
    return this.getItem(id);
  }

  updateVersionNote(id, note) {
    this.db.run("UPDATE versions SET note=? WHERE id=?", [note, id]);
    return this.getVersion(id);
  }

  // Copy a file into a project. If an item in the project already has a
  // version with the same filename (or `intoItemId` is given), it becomes a new
  // version; otherwise it becomes a new item. Returns the item.
  async addFile(projectId, srcPath, { intoItemId = null, subdir = "", note = "" } = {}) {
    const project = this.getProject(projectId);
    if (!project) throw new Error("project not found");
    const filename = path.basename(srcPath);
    let item = intoItemId ? this.getItem(intoItemId) : null;
    if (!item) {
      const hit = this.db.get(
        "SELECT i.id FROM items i JOIN versions v ON v.item_id=i.id WHERE i.project_id=? AND v.filename=? COLLATE NOCASE LIMIT 1",
        [projectId, filename]
      );
      if (hit) item = this.getItem(hit.id);
    }
    const t = now();
    if (!item) {
      const name = subdir ? path.join(subdir, filename) : filename;
      this.db.run("INSERT INTO items(project_id,name,kind,created,updated) VALUES(?,?,?,?,?)", [projectId, name, extract.kindOf(filename), t, t]);
      item = this.getItem(this.db.lastId());
      this.log("item.add", name, projectId, item.id);
    }
    const versionNo = (item.versions[0]?.version_no || 0) + 1;

    // Superseded copy with the same name moves to _versions so the new file
    // can take its place at the top level.
    const targetDir = path.join(project.folder, subdir);
    const target = path.join(targetDir, filename);
    const prev = item.versions.find((v) => v.filename.toLowerCase() === filename.toLowerCase() && v.relpath.toLowerCase() === target.toLowerCase());
    if (prev) {
      const archived = path.join(project.folder, "_versions", String(item.id), `v${prev.version_no}`, filename);
      await fs.mkdir(path.dirname(this.abs(archived)), { recursive: true });
      await fs.rename(this.abs(prev.relpath), this.abs(archived)).catch(() => {});
      this.db.run("UPDATE versions SET relpath=? WHERE id=?", [archived, prev.id]);
    }
    await fs.mkdir(this.abs(targetDir), { recursive: true });
    if (path.resolve(srcPath) !== path.resolve(this.abs(target))) await fs.copyFile(srcPath, this.abs(target));
    const st = await fs.stat(this.abs(target));
    const hash = await hashFile(this.abs(target));
    this.db.run(
      "INSERT INTO versions(item_id,version_no,filename,relpath,size,mtime,hash,added,note) VALUES(?,?,?,?,?,?,?,?,?)",
      [item.id, versionNo, filename, target, st.size, st.mtime.toISOString(), hash, t, note]
    );
    const versionId = this.db.lastId();
    this.log(versionNo > 1 ? "version.add" : "file.add", `${filename} v${versionNo}`, projectId, item.id);
    this.db.run("UPDATE items SET updated=? WHERE id=?", [t, item.id]);
    this.db.run("UPDATE projects SET updated=? WHERE id=?", [t, projectId]);
    await this.extractVersion(versionId);
    return this.getItem(item.id);
  }

  // Import a whole folder as (or into) a project, preserving subfolders.
  async importFolder(projectId, folder, onProgress) {
    const files = [];
    const walk = async (dir, rel) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith("~$") || e.name === "Thumbs.db" || e.name === "desktop.ini") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, path.join(rel, e.name));
        else if (e.isFile()) files.push({ full, rel });
      }
    };
    await walk(folder, "");
    let n = 0;
    const errors = [];
    for (const f of files) {
      try {
        await this.addFile(projectId, f.full, { subdir: f.rel });
      } catch (err) {
        errors.push(`${f.rel}${path.sep}${path.basename(f.full)}: ${err.message}`);
      }
      n++;
      if (onProgress) onProgress({ done: n, total: files.length, current: path.basename(f.full) });
    }
    return { count: n, errors };
  }

  async extractVersion(versionId) {
    const v = this.getVersion(versionId);
    if (!v) return;
    const r = await extract.extract(this.abs(v.relpath));
    let thumb = "";
    if (r.image) {
      thumb = `${versionId}.png`;
      await fs.writeFile(path.join(this.thumbDir, thumb), r.image);
    }
    this.db.run("UPDATE versions SET meta=?, text=?, thumb=?, pending=? WHERE id=?", [j(r.meta || {}), r.text || "", thumb, r.pending || "", versionId]);
    if (this.db.get("SELECT kind FROM items WHERE id=?", [v.item_id])?.kind === "other" && r.kind !== "other")
      this.db.run("UPDATE items SET kind=? WHERE id=?", [r.kind, v.item_id]);
    // Assembly check: are the referenced components in the same folder?
    if (r.refs && r.refs.length) {
      const dir = path.dirname(this.abs(v.relpath));
      const missing = r.refs.filter((name) => !fss.existsSync(path.join(dir, name)));
      const meta = { ...r.meta, "Missing components": missing.length ? missing : "none" };
      this.db.run("UPDATE versions SET meta=? WHERE id=?", [j(meta), versionId]);
    }
    return this.getVersion(versionId);
  }

  async reextractAll(onProgress) {
    const ids = this.db.all("SELECT id FROM versions").map((r) => r.id);
    let n = 0;
    for (const id of ids) {
      await this.extractVersion(id);
      n++;
      if (onProgress) onProgress({ done: n, total: ids.length });
    }
  }

  // Renderer-side results (mesh render, pdf page, video frame).
  async completePending(versionId, { image, text, meta }) {
    const v = this.getVersion(versionId);
    if (!v) return;
    let thumb = v.thumb;
    if (image) {
      thumb = `${versionId}.png`;
      await fs.writeFile(path.join(this.thumbDir, thumb), Buffer.from(image));
    }
    const merged = { ...v.meta, ...(meta || {}) };
    this.db.run("UPDATE versions SET thumb=?, text=?, meta=?, pending='' WHERE id=?", [thumb, text ?? v.text, j(merged), versionId]);
    return this.getVersion(versionId);
  }

  listPending() {
    return this.db.all("SELECT id, relpath, pending FROM versions WHERE pending!=''").map((r) => ({ ...r, abs: this.abs(r.relpath) }));
  }

  // ── deletion (always with a reason; files go to trash, NAS handled later) ──
  async trashFile(relpath) {
    const stamp = now().replace(/[:.]/g, "-");
    const dest = path.join(".drafthouse", "trash", stamp, relpath);
    await fs.mkdir(path.dirname(this.abs(dest)), { recursive: true });
    try {
      await fs.rename(this.abs(relpath), this.abs(dest));
    } catch {
      return "";
    }
    return dest;
  }

  async deleteVersion(versionId, reason) {
    const v = this.getVersion(versionId);
    if (!v) return;
    const item = this.getItem(v.item_id);
    const project = this.getProject(item.project_id);
    const trash = await this.trashFile(v.relpath);
    this.db.run("INSERT INTO deletions(ts,project_name,item_name,relpath,trash_path,reason) VALUES(?,?,?,?,?,?)", [now(), project.name, item.name, v.relpath, trash, reason]);
    this.db.run("DELETE FROM versions WHERE id=?", [versionId]);
    await fs.unlink(path.join(this.thumbDir, v.thumb)).catch(() => {});
    this.log("version.delete", `${v.filename} v${v.version_no}: ${reason}`, project.id, item.id);
    if (!this.listVersions(item.id).length) {
      this.db.run("DELETE FROM items WHERE id=?", [item.id]);
      this.log("item.delete", item.name, project.id, item.id);
      return null;
    }
    return this.getItem(item.id);
  }

  async deleteItem(itemId, reason) {
    const item = this.getItem(itemId);
    if (!item) return;
    for (const v of item.versions) await this.deleteVersion(v.id, reason);
  }

  async deleteProject(projectId, reason) {
    const p = this.getProject(projectId);
    if (!p) return;
    for (const it of this.listItems(projectId)) await this.deleteItem(it.id, reason);
    this.db.run("DELETE FROM projects WHERE id=?", [projectId]);
    this.log("project.delete", `${p.name}: ${reason}`, projectId);
    // Remove the (now empty apart from _versions leftovers) folder to trash.
    await this.trashFile(p.folder).catch(() => {});
  }

  pendingDeletions() {
    return this.db.all("SELECT * FROM deletions WHERE nas_state='pending' ORDER BY ts");
  }
  markDeletionDone(id) {
    this.db.run("UPDATE deletions SET nas_state='done' WHERE id=?", [id]);
  }
  listDeletions() {
    return this.db.all("SELECT * FROM deletions ORDER BY ts DESC LIMIT 500");
  }

  // ── fields ────────────────────────────────────────────────────
  listFieldDefs() {
    return this.db.all("SELECT * FROM field_defs ORDER BY scope, sort, id").map(parseRow);
  }
  saveFieldDef(def) {
    const options = j(def.options || []);
    if (def.id) {
      this.db.run("UPDATE field_defs SET name=?,type=?,options=?,sort=? WHERE id=?", [def.name, def.type, options, def.sort || 0, def.id]);
      return def.id;
    }
    this.db.run("INSERT INTO field_defs(scope,name,type,options,sort) VALUES(?,?,?,?,?)", [def.scope, def.name, def.type || "text", options, def.sort || 0]);
    return this.db.lastId();
  }
  deleteFieldDef(id) {
    this.db.run("DELETE FROM field_defs WHERE id=?", [id]);
  }

  // ── history & search ──────────────────────────────────────────
  history(projectId = null, limit = 200) {
    return projectId
      ? this.db.all("SELECT * FROM changelog WHERE project_id=? ORDER BY id DESC LIMIT ?", [projectId, limit])
      : this.db.all("SELECT c.*, p.name AS project_name FROM changelog c LEFT JOIN projects p ON p.id=c.project_id ORDER BY c.id DESC LIMIT ?", [limit]);
  }

  search(q) {
    q = String(q || "").trim();
    if (!q) return { projects: [], items: [] };
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const like = (col) => terms.map(() => `lower(${col}) LIKE ?`).join(" AND ");
    const params = () => terms.map((t) => `%${t}%`);
    const projects = this.db
      .all(`SELECT * FROM projects WHERE ${like("name||' '||category||' '||description||' '||notes||' '||tags||' '||fields")}`, params())
      .map(parseRow);
    const items = this.db
      .all(
        `SELECT i.*, p.name AS project_name, p.folder AS project_folder,
          (SELECT v.thumb FROM versions v WHERE v.item_id=i.id AND v.thumb!='' ORDER BY v.version_no DESC LIMIT 1) AS thumb
         FROM items i JOIN projects p ON p.id=i.project_id
         WHERE ${like("i.name||' '||i.notes||' '||i.tags||' '||i.fields||' '||(SELECT group_concat(v.filename||' '||v.note||' '||v.meta||' '||substr(v.text,1,20000),' ') FROM versions v WHERE v.item_id=i.id)")}
         LIMIT 300`,
        params()
      )
      .map(parseRow);
    return { projects, items };
  }

  stats() {
    const s = this.db.get(
      `SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM items) AS items,
        (SELECT COUNT(*) FROM versions) AS versions, (SELECT COALESCE(SUM(size),0) FROM versions) AS bytes`
    );
    s.byStatus = Object.fromEntries(this.db.all("SELECT status, COUNT(*) AS n FROM projects GROUP BY status").map((r) => [r.status, r.n]));
    s.byKind = Object.fromEntries(this.db.all("SELECT kind, COUNT(*) AS n FROM items GROUP BY kind ORDER BY n DESC").map((r) => [r.kind, r.n]));
    s.recent = this.db
      .all(
        `SELECT i.*, p.name AS project_name, (SELECT v.thumb FROM versions v WHERE v.item_id=i.id AND v.thumb!='' ORDER BY v.version_no DESC LIMIT 1) AS thumb
         FROM items i JOIN projects p ON p.id=i.project_id ORDER BY i.updated DESC LIMIT 12`
      )
      .map(parseRow);
    return s;
  }
}

module.exports = { Library, STATUSES, safeName };
