// App settings, stored as JSON in Electron's userData folder. This is the only
// state that lives outside the library folder: where the library is, where the
// NAS mirror is, and cosmetic preferences.
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const DEFAULTS = {
  libraryPath: "",
  nasPath: "\\\\192.168.1.204\\Apocrypha_Main_Pool\\Libary_Pool\\Drafthouse Library",
  theme: "dark",
  backupOnQuit: false,
  view: "grid",
  lastProjectId: null,
};

class Settings {
  constructor() {
    this.file = path.join(app.getPath("userData"), "settings.json");
    this.data = { ...DEFAULTS };
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    } catch {
      /* first run */
    }
  }
  get() {
    return { ...this.data };
  }
  set(patch) {
    this.data = { ...this.data, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
