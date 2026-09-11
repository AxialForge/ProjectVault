// Add-in registry. Each add-in is a module exporting
//   { id, name, icon, blurb, render(container, ctx) }
// ctx = { api, project, projects, toast, refresh }. Add a file here and list it.
import sheets from "./sheets.js";

export const ADDINS = [sheets];
