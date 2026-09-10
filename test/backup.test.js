const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const backup = require("../src/main/backup");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dh-"));
}

test("backup mirrors new files, skips unchanged, never deletes without a deletion record", async () => {
  const lib = tmp(), nas = tmp();
  fs.mkdirSync(path.join(lib, "Proj"), { recursive: true });
  fs.writeFileSync(path.join(lib, "Proj", "a.stl"), "aaa");
  fs.writeFileSync(path.join(lib, "projectvault.db"), "db");
  fs.mkdirSync(path.join(lib, ".projectvault", "trash", "x"), { recursive: true });
  fs.writeFileSync(path.join(lib, ".projectvault", "trash", "x", "junk"), "junk");
  fs.writeFileSync(path.join(nas, "orphan.txt"), "left alone");

  let r = await backup.run({ libraryPath: lib, nasPath: nas, deletions: [], onDeletionDone: () => {} });
  assert.equal(r.copied, 2);
  assert.equal(fs.readFileSync(path.join(nas, "Proj", "a.stl"), "utf8"), "aaa");
  assert.ok(!fs.existsSync(path.join(nas, ".projectvault", "trash")), "trash is not mirrored");
  assert.ok(fs.existsSync(path.join(nas, "orphan.txt")), "unknown NAS files untouched");

  r = await backup.run({ libraryPath: lib, nasPath: nas, deletions: [], onDeletionDone: () => {} });
  assert.equal(r.copied, 0);
  assert.equal(r.skipped, 2);

  // delete locally with a reason -> NAS copy moves to _Deleted and is logged
  fs.unlinkSync(path.join(lib, "Proj", "a.stl"));
  const done = [];
  r = await backup.run({
    libraryPath: lib, nasPath: nas,
    deletions: [{ id: 7, ts: "2026-09-07T01:02:03.000Z", project_name: "Proj", item_name: "a.stl", relpath: path.join("Proj", "a.stl"), reason: "superseded" }],
    onDeletionDone: (id) => done.push(id),
  });
  assert.equal(r.deleted, 1);
  assert.deepEqual(done, [7]);
  assert.ok(!fs.existsSync(path.join(nas, "Proj", "a.stl")));
  const moved = path.join(nas, "_Deleted", "2026-09-07T01-02-03-000Z", "Proj", "a.stl");
  assert.equal(fs.readFileSync(moved, "utf8"), "aaa");
  assert.match(fs.readFileSync(path.join(nas, "_Deleted", "deletions.log"), "utf8"), /superseded/);
});
