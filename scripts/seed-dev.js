require.cache[require.resolve("electron", { paths: [__dirname + "/.."] })] = { exports: { nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) } } };
const { Library } = require("C:/Project Folder/ProjectVault/src/main/library");
(async () => {
  const lib = await Library.open(process.argv[2]);
  const have = new Set(lib.listProjects().map((p) => p.name));
  await lib.createFolder("", "Furniture").catch(() => {});
  await lib.createFolder("Furniture", "2nd Bedroom").catch(() => {});
  await lib.createFolder("Furniture", "Living Room").catch(() => {});
  await lib.createFolder("", "3D Printing").catch(() => {});
  await lib.createFolder("", "Electronics").catch(() => {});
  const mk = async (name, category, status, progress) => { if (have.has(name)) return; const p = await lib.createProject({ name, category, status }); await lib.updateProject(p.id, { progress }); };
  await mk("Main Shelf", "Furniture/2nd Bedroom", "in-progress", 60);
  await mk("Night Stand Tall", "Furniture/2nd Bedroom", "done", 100);
  await mk("TV Console", "Furniture/Living Room", "planning", 10);
  await mk("Rack Ears", "3D Printing", "in-progress", 40);
  await mk("Power Panel", "Electronics", "idea", 0);
  console.log(lib.listFolders().map((f) => f.path + " (" + f.projectsDeep + ")").join(", "));
  lib.close();
})();
