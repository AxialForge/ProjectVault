// SQLite via sql.js (pure WASM, no native build). The whole database is held in
// memory and flushed to <library>/projectvault.db shortly after every write. At
// the size of a personal library (hundreds to low thousands of files) this is
// instant and sidesteps the native-addon build trap on this machine.
const path = require("node:path");
const fs = require("node:fs");
const initSqlJs = require("sql.js");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea',
  progress INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '{}',
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '{}',
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_project ON items(project_id);
CREATE TABLE IF NOT EXISTS versions(
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  filename TEXT NOT NULL,
  relpath TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  added TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  thumb TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  pending TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS versions_item ON versions(item_id);
CREATE TABLE IF NOT EXISTS folders(
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS field_defs(
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  options TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS changelog(
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  project_id INTEGER,
  item_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS deletions(
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  project_name TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  relpath TEXT NOT NULL,
  trash_path TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  nas_state TEXT NOT NULL DEFAULT 'pending'
);
`;

class Database {
  static async open(libraryPath) {
    const SQL = await initSqlJs({
      locateFile: (f) => path.join(path.dirname(require.resolve("sql.js")), f),
    });
    const file = path.join(libraryPath, "projectvault.db");
    let db;
    if (fs.existsSync(file)) db = new SQL.Database(fs.readFileSync(file));
    else db = new SQL.Database();
    db.exec(SCHEMA);
    return new Database(db, file);
  }

  constructor(db, file) {
    this.db = db;
    this.file = file;
    this.timer = null;
    this.dirty = false;
  }

  // Run a statement that doesn't return rows; schedules a flush.
  run(sql, params = []) {
    this.db.run(sql, params);
    this.dirty = true;
    this.scheduleFlush();
  }

  // Return all rows as plain objects.
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  lastId() {
    return this.get("SELECT last_insert_rowid() AS id").id;
  }

  scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    const data = Buffer.from(this.db.export());
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  close() {
    this.flush();
    this.db.close();
  }
}

module.exports = { Database };
