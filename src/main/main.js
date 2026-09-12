const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const { Settings } = require("./settings");
const { Library, STATUSES } = require("./library");
const backup = require("./backup");
const updater = require("./updater");
const health = require("./health");
const exporter = require("./export");
const sheets = require("./sheets");

const isDev = process.argv.includes("--dev") || !app.isPacked;
// A from-source run keeps its own settings and single-instance lock so
// `npm run dev` opens beside an installed copy.
if (!app.isPackaged) app.setPath("userData", app.getPath("userData") + "-dev");

let win = null;
let settings = null;
let lib = null;
let backupRunning = false;

// Library files (thumbnails, photos, PDFs, videos) are served to the renderer
// over a private scheme instead of file:// so the page can stay locked down.
protocol.registerSchemesAsPrivileged([{ scheme: "lib", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }]);

function overlayColors(dark) {
  return dark ? { color: "#151a23", symbolColor: "#98a2b8", height: 40 } : { color: "#ffffff", symbolColor: "#4d5870", height: 40 };
}

function createWindow() {
  const dark = settings.get().theme !== "light";
  nativeTheme.themeSource = dark ? "dark" : "light";
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 660,
    show: false,
    backgroundColor: dark ? "#0f1218" : "#f4f6fa",
    titleBarStyle: "hidden",
    titleBarOverlay: overlayColors(dark),
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });
  const q = {};
  for (const a of process.argv) { const m = /^--(item|page|sel)=(.+)$/.exec(a); if (m && isDev) q[m[1]] = m[2]; }
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), Object.keys(q).length ? { query: q } : undefined);
  win.once("ready-to-show", () => win.show());
  if (isDev) {
    win.webContents.on("console-message", (ev) => console.log("[renderer]", ev.level, ev.message, ev.sourceId + ":" + ev.lineNumber));
    win.webContents.on("preload-error", (_e, p, err) => console.log("[preload-error]", p, err));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (isDev && process.argv.includes("--devtools")) win.webContents.openDevTools({ mode: "detach" });
  // Dev aid: --shot=<file.png> captures the window after it settles.
  const shot = process.argv.find((a) => a.startsWith("--shot="));
  if (isDev && shot) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(shot.slice(7), img.toPNG());
      console.log("shot written");
    }, 9000);
  }
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

async function openLibrary(root) {
  if (lib) lib.close();
  lib = null;
  if (!root) return null;
  fs.mkdirSync(root, { recursive: true });
  lib = await Library.open(root);
  settings.set({ libraryPath: root });
  return libraryInfo();
}

function libraryInfo() {
  if (!lib) return { open: false, path: settings.get().libraryPath };
  return { open: true, path: lib.root, statuses: STATUSES };
}

function need() {
  if (!lib) throw new Error("No library is open");
  return lib;
}

// ── IPC ──────────────────────────────────────────────────────────
ipcMain.handle("settings:get", () => settings.get());
ipcMain.handle("settings:set", (_e, patch) => {
  const before = settings.get();
  const after = settings.set(patch);
  if (patch.theme && patch.theme !== before.theme) {
    const dark = patch.theme !== "light";
    nativeTheme.themeSource = dark ? "dark" : "light";
    win?.setTitleBarOverlay(overlayColors(dark));
    win?.setBackgroundColor(dark ? "#0f1218" : "#f4f6fa");
  }
  return after;
});
ipcMain.handle("dialog:folder", async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: opts.title || "Choose a folder", defaultPath: opts.defaultPath });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("dialog:files", async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], title: opts.title || "Add files" });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("library:open", (_e, root) => openLibrary(root));
ipcMain.handle("library:info", () => libraryInfo());
ipcMain.handle("library:stats", () => need().stats());
ipcMain.handle("library:fileUrl", (_e, rel) => "lib://file/" + encodeURIComponent(rel));

ipcMain.handle("projects:list", () => need().listProjects());
ipcMain.handle("projects:get", (_e, id) => need().getProject(id));
ipcMain.handle("projects:create", (_e, data) => need().createProject(data));
ipcMain.handle("projects:update", (_e, id, patch) => need().updateProject(id, patch));
ipcMain.handle("projects:delete", (_e, id, reason) => need().deleteProject(id, reason));

ipcMain.handle("folders:list", () => need().listFolders());
ipcMain.handle("folders:create", (_e, parent, name) => need().createFolder(parent, name));
ipcMain.handle("folders:move", (_e, from, to) => need().moveFolder(from, to));
ipcMain.handle("folders:delete", (_e, p) => need().deleteFolder(p));
ipcMain.handle("folders:notes", (_e, p, notes) => need().updateFolderNotes(p, notes));
ipcMain.handle("folders:info", (_e, p) => need().folderInfo(p));
ipcMain.handle("projects:move", (_e, id, category) => need().moveProject(id, category));
ipcMain.handle("items:list", (_e, pid) => need().listItems(pid));
ipcMain.handle("items:get", (_e, id) => need().getItem(id));
ipcMain.handle("items:update", (_e, id, patch) => need().updateItem(id, patch));
ipcMain.handle("items:delete", (_e, id, reason) => need().deleteItem(id, reason));
ipcMain.handle("items:addFiles", async (_e, pid, paths) => {
  const l = need();
  const out = [];
  const errors = [];
  let n = 0;
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        const r = await l.importFolder(pid, p, (prog) => send("progress", { label: "Importing " + path.basename(p), ...prog }));
        errors.push(...r.errors);
      } else out.push(await l.addFile(pid, p));
    } catch (err) {
      errors.push(`${path.basename(p)}: ${err.message}`);
    }
    n++;
    send("progress", { label: "Adding files", done: n, total: paths.length, current: path.basename(p) });
  }
  send("progress", null);
  return { items: out, errors };
});
ipcMain.handle("items:addVersion", async (_e, itemId, filePath, note) => {
  const l = need();
  const item = l.getItem(itemId);
  return l.addFile(item.project_id, filePath, { intoItemId: itemId, note: note || "" });
});
ipcMain.handle("items:importFolder", async (_e, pid, folder) => {
  const r = await need().importFolder(pid, folder, (prog) => send("progress", { label: "Importing folder", ...prog }));
  send("progress", null);
  return r;
});
ipcMain.handle("versions:delete", (_e, id, reason) => need().deleteVersion(id, reason));
ipcMain.handle("versions:note", (_e, id, note) => need().updateVersionNote(id, note));
ipcMain.handle("versions:reextract", (_e, id) => need().extractVersion(id));
ipcMain.handle("versions:reextractAll", async () => {
  await need().reextractAll((prog) => send("progress", { label: "Re-reading files", ...prog }));
  send("progress", null);
  return true;
});
ipcMain.handle("versions:pending", () => need().listPending());
ipcMain.handle("versions:complete", (_e, id, data) => need().completePending(id, data));

ipcMain.handle("fields:list", () => need().listFieldDefs());
ipcMain.handle("fields:save", (_e, def) => need().saveFieldDef(def));
ipcMain.handle("fields:delete", (_e, id) => need().deleteFieldDef(id));
ipcMain.handle("history:list", (_e, pid, limit) => need().history(pid, limit));
ipcMain.handle("deletions:list", () => need().listDeletions());
ipcMain.handle("search", (_e, q) => need().search(q));

ipcMain.handle("shell:open", async (_e, rel) => {
  const err = await shell.openPath(need().abs(rel));
  return err || "";
});
ipcMain.handle("shell:reveal", (_e, rel) => shell.showItemInFolder(need().abs(rel)));
ipcMain.handle("shell:external", (_e, url) => /^https?:/.test(url) && shell.openExternal(url));

ipcMain.handle("backup:check", async () => {
  const nas = settings.get().nasPath;
  if (!nas) return { ok: false, reason: "No NAS path set" };
  const parent = path.dirname(nas);
  const ok = await backup.exists(parent);
  return { ok, reason: ok ? "" : "NAS share not reachable", pending: lib ? lib.pendingDeletions().length : 0 };
});
ipcMain.handle("backup:run", async () => {
  const l = need();
  if (backupRunning) throw new Error("A backup is already running");
  backupRunning = true;
  try {
    l.db.flush();
    const report = await backup.run({
      libraryPath: l.root,
      nasPath: settings.get().nasPath,
      deletions: l.pendingDeletions(),
      onProgress: (p) => send("backup:progress", p),
      onDeletionDone: (id) => l.markDeletionDone(id),
    });
    l.log("backup", `${report.copied} copied, ${report.deleted} moved to _Deleted, ${report.errors.length} errors`);
    settings.set({ lastBackup: report.finished });
    send("backup:progress", null);
    return report;
  } finally {
    backupRunning = false;
  }
});

ipcMain.handle("library:health", () => health.check(need()));
ipcMain.handle("update:check", () => updater.checkNow());
ipcMain.handle("update:install", () => updater.installNow());
ipcMain.handle("projects:export", async (_e, pid, opts = {}) => {
  const l = need();
  const p = l.getProject(pid);
  const r = await dialog.showSaveDialog(win, { title: "Export project", defaultPath: path.join(app.getPath("documents"), safeFile(p.name) + ".zip"), filters: [{ name: "Zip archive", extensions: ["zip"] }] });
  if (r.canceled) return null;
  const out = await exporter.exportProject(l, pid, r.filePath, { ...opts, onProgress: (prog) => send("progress", { label: "Exporting", ...prog }) });
  send("progress", null);
  l.log("project.export", path.basename(r.filePath), pid);
  return out;
});
ipcMain.handle("sheets:pdf", async (_e, html, opts) => Buffer.from(await sheets.htmlToPdf(html, opts)));
ipcMain.handle("sheets:save", async (_e, { html, opts, projectId, filename }) => {
  const l = need();
  const pdf = Buffer.from(await sheets.htmlToPdf(html, opts));
  if (projectId) {
    const tmp = path.join(app.getPath("temp"), filename);
    fs.writeFileSync(tmp, pdf);
    const item = await l.addFile(projectId, tmp);
    fs.unlinkSync(tmp);
    return { item };
  }
  const r = await dialog.showSaveDialog(win, { title: "Save sheet", defaultPath: path.join(app.getPath("documents"), filename), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, pdf);
  return { path: r.filePath };
});
function safeFile(s) {
  return String(s).replace(/[<>:"/\|?* -]/g, "-").trim() || "export";
}

ipcMain.handle("win:minimize", () => win.minimize());
ipcMain.handle("win:maximize", () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.handle("win:close", () => win.close());
ipcMain.handle("app:version", () => app.getVersion());

// ── lifecycle ────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  settings = new Settings();
  protocol.handle("lib", async (req) => {
    if (!lib) return new Response("no library", { status: 404 });
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    const abs = u.host === "thumb" ? path.join(lib.thumbDir, rel) : lib.abs(rel);
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(path.resolve(lib.root))) return new Response("forbidden", { status: 403 });
    const res = await net.fetch(pathToFileURL(resolved).toString());
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(res.body, { status: res.status, headers });
  });
  const root = settings.get().libraryPath;
  if (root) {
    try {
      await openLibrary(root);
    } catch (err) {
      console.error("library open failed", err);
    }
  }
  createWindow();
  updater.start({ onStatus: (s) => send("update:status", s) });
});

app.on("window-all-closed", () => app.quit());

// Optional backup-on-quit: hold the quit, mirror, then really quit.
let quitBackupDone = false;
app.on("before-quit", (e) => {
  if (lib && settings.get().backupOnQuit && settings.get().nasPath && !quitBackupDone && !backupRunning) {
    e.preventDefault();
    quitBackupDone = true;
    backupRunning = true;
    lib.db.flush();
    backup
      .run({ libraryPath: lib.root, nasPath: settings.get().nasPath, deletions: lib.pendingDeletions(), onDeletionDone: (id) => lib.markDeletionDone(id) })
      .then((r) => {
        lib.log("backup", `on quit: ${r.copied} copied, ${r.deleted} moved to _Deleted, ${r.errors.length} errors`);
        settings.set({ lastBackup: r.finished });
      })
      .catch((err) => console.error("quit backup failed", err))
      .finally(() => {
        backupRunning = false;
        app.quit();
      });
    return;
  }
  if (lib) lib.close();
});
