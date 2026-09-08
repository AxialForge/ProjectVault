const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld("api", {
  // settings / library
  settings: invoke("settings:get"),
  setSettings: invoke("settings:set"),
  pickFolder: invoke("dialog:folder"),
  pickFiles: invoke("dialog:files"),
  openLibrary: invoke("library:open"),
  libraryInfo: invoke("library:info"),
  stats: invoke("library:stats"),
  fileUrl: invoke("library:fileUrl"),
  // projects
  listProjects: invoke("projects:list"),
  getProject: invoke("projects:get"),
  createProject: invoke("projects:create"),
  updateProject: invoke("projects:update"),
  deleteProject: invoke("projects:delete"),
  // items
  listItems: invoke("items:list"),
  getItem: invoke("items:get"),
  updateItem: invoke("items:update"),
  deleteItem: invoke("items:delete"),
  addFiles: invoke("items:addFiles"),
  addVersion: invoke("items:addVersion"),
  importFolder: invoke("items:importFolder"),
  deleteVersion: invoke("versions:delete"),
  updateVersionNote: invoke("versions:note"),
  reextract: invoke("versions:reextract"),
  reextractAll: invoke("versions:reextractAll"),
  listPending: invoke("versions:pending"),
  completePending: invoke("versions:complete"),
  // fields / history / search
  fieldDefs: invoke("fields:list"),
  saveFieldDef: invoke("fields:save"),
  deleteFieldDef: invoke("fields:delete"),
  history: invoke("history:list"),
  deletions: invoke("deletions:list"),
  search: invoke("search"),
  // shell
  openPath: invoke("shell:open"),
  revealPath: invoke("shell:reveal"),
  openExternal: invoke("shell:external"),
  // backup
  backupRun: invoke("backup:run"),
  backupCheck: invoke("backup:check"),
  // window
  minimize: invoke("win:minimize"),
  toggleMaximize: invoke("win:maximize"),
  close: invoke("win:close"),
  version: invoke("app:version"),
  // drag & drop: real paths for dropped File objects
  pathFor: (file) => webUtils.getPathForFile(file),
  on: (channel, fn) => {
    const ok = ["progress", "backup:progress", "update:status", "library:changed"];
    if (!ok.includes(channel)) return () => {};
    const handler = (_e, data) => fn(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
