// Exercise export + PDF sheet generation without the GUI:
//   npx electron scripts/smoke-features.js <libraryFolder>
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { Library } = require("../src/main/library");
const exporter = require("../src/main/export");
const sheets = require("../src/main/sheets");
const health = require("../src/main/health");

app.whenReady().then(async () => {
  const [libDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  let failed = false;
  try {
    const lib = await Library.open(libDir);
    const project = lib.listProjects()[0];
    const zipPath = path.join(os.tmpdir(), "pv-export-test.zip");
    const r = await exporter.exportProject(lib, project.id, zipPath, {});
    const size = fs.statSync(zipPath).size;
    console.log(`export: ${r.files} files -> ${zipPath} (${size} bytes)`);
    if (size < 1000) failed = true;
    const pdf = await sheets.htmlToPdf("<html><body style='font:40px Arial'><h1>Title test</h1></body></html>", { size: "ledger", landscape: true });
    console.log(`pdf: ${pdf.length} bytes, header ${Buffer.from(pdf).subarray(0, 5).toString()}`);
    if (!Buffer.from(pdf).subarray(0, 4).equals(Buffer.from("%PDF"))) failed = true;
    const h = health.check(lib);
    console.log(`health: ok=${h.ok} versions=${h.versions} missing=${h.missing.length} orphans=${h.orphanCount}`);
    lib.close();
  } catch (err) {
    console.error("FAILED", err);
    failed = true;
  }
  app.exit(failed ? 1 : 0);
});
