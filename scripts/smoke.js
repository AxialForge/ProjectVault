// Main-process smoke test, run under Electron (nativeImage needs it):
//   npx electron scripts/smoke.js <libraryFolder> <file-or-folder>...
// Opens/creates a library, makes a project, imports the given paths, and
// prints what was extracted for each file. Exits non-zero on any error.
const { app } = require("electron");
const path = require("node:path");
const { Library } = require("../src/main/library");

app.whenReady().then(async () => {
  const [libDir, ...inputs] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!libDir) {
    console.error("usage: electron scripts/smoke.js <libraryFolder> <paths...>");
    app.exit(2);
  }
  let failed = false;
  try {
    const lib = await Library.open(libDir);
    let project = lib.listProjects()[0];
    if (!project) project = await lib.createProject({ name: "Smoke Test", category: "Tests", status: "in-progress" });
    for (const p of inputs) {
      const r = await lib.importFolderOrFile?.(project.id, p);
      void r;
    }
    const fs = require("node:fs");
    for (const p of inputs) {
      if (fs.statSync(p).isDirectory()) {
        const r = await lib.importFolder(project.id, p);
        console.log(`imported folder ${p}: ${r.count} files, ${r.errors.length} errors`);
        for (const e of r.errors) console.log("   ERR", e);
      } else await lib.addFile(project.id, p);
    }
    for (const it of lib.listItems(project.id)) {
      const v = it.versions[0];
      console.log(`\n== ${it.name} [${it.kind}] v${v.version_no} ${v.size}B thumb=${v.thumb || "-"} pending=${v.pending || "-"}`);
      for (const [k, val] of Object.entries(v.meta)) {
        const s = typeof val === "object" ? JSON.stringify(val) : String(val);
        console.log(`   ${k}: ${s.slice(0, 140)}`);
        if (k === "Extraction error") failed = true;
      }
      if (v.text) console.log(`   text: ${v.text.slice(0, 80).replace(/\s+/g, " ")}…`);
    }
    console.log("\nsearch 'rack':", lib.search("rack").items.map((i) => i.name));
    console.log("stats:", JSON.stringify(lib.stats().byKind));
    lib.close();
  } catch (err) {
    console.error("SMOKE FAILED", err);
    failed = true;
  }
  app.exit(failed ? 1 : 0);
});
