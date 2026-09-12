// Folder tree operations against a temp library (sql.js, no Electron needed
// for these paths because nothing here extracts files).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// library.js pulls in extract/index.js which requires electron's nativeImage
// lazily via image.js; stub it so the module loads under plain Node.
require.cache[require.resolve("electron")] = { exports: { nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) } } };
const { Library } = require("../src/main/library");

test("create, move, rename folders and projects keeps disk and catalogue in step", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-"));
  const lib = await Library.open(root);
  await lib.createFolder("", "Furniture");
  await lib.createFolder("Furniture", "2nd Bed");
  const p = await lib.createProject({ name: "Main Shelf", category: "Furniture/2nd Bed" });
  assert.equal(p.category, "Furniture/2nd Bed");
  assert.equal(p.folder, path.join("Furniture", "2nd Bed", "Main Shelf"));
  assert.ok(fs.existsSync(path.join(root, "Furniture", "2nd Bed", "Main Shelf")));
  // a file in the project
  const f = path.join(root, p.folder, "shelf.txt");
  fs.writeFileSync(f, "hi");
  const src = path.join(os.tmpdir(), "pv-src.txt");
  fs.writeFileSync(src, "hello");
  await lib.addFile(p.id, src);
  // rename folder "2nd Bed" -> "Second Bedroom"
  await lib.moveFolder("Furniture/2nd Bed", "Furniture/Second Bedroom");
  const p2 = lib.getProject(p.id);
  assert.equal(p2.category, "Furniture/Second Bedroom");
  assert.ok(fs.existsSync(path.join(root, "Furniture", "Second Bedroom", "Main Shelf", "pv-src.txt")));
  const v = lib.listItems(p.id)[0].versions[0];
  assert.equal(v.relpath, path.join("Furniture", "Second Bedroom", "Main Shelf", "pv-src.txt"));
  assert.ok(fs.existsSync(lib.abs(v.relpath)));
  // move project to root
  await lib.moveProject(p.id, "");
  assert.equal(lib.getProject(p.id).folder, "Main Shelf");
  assert.ok(fs.existsSync(path.join(root, "Main Shelf", "pv-src.txt")));
  // empty folder can be deleted, non-empty cannot
  await lib.deleteFolder("Furniture/Second Bedroom");
  assert.ok(!fs.existsSync(path.join(root, "Furniture", "Second Bedroom")));
  await lib.moveProject(p.id, "Furniture");
  await assert.rejects(() => lib.deleteFolder("Furniture"), /not empty/);
  // rename project renames disk folder
  await lib.renameProject(p.id, "Tall Shelf");
  assert.ok(fs.existsSync(path.join(root, "Furniture", "Tall Shelf", "pv-src.txt")));
  assert.deepEqual(lib.listFolders().map((x) => x.path), ["Furniture"]);
  lib.close();
});
