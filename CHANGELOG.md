# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.3.0] - 2026-09-12

- Folders are real: any depth, empty folders allowed, notes per folder.
- New Structure page: tree editor with drag and drop for projects and folders, rename, sub-folder, delete (empty only), folder info with disk and NAS paths, counts and status.
- Folder picker on the project header and in New Project replaces the free-text category box; "New folder…" is right in the list.
- Sidebar tree shows empty folders and accepts project drops; double-click a folder to open it in Structure.
- Renaming or moving a folder or project moves it on disk and rewrites every file path in the catalogue.
- Fix: changing a project category previously only changed the label, not the disk folder.

## [0.2.1] - 2026-09-11

- New home dashboard: quick actions (new project, add files, backup, drawing sheet, search), continue-where-you-left-off card, backup age warning, in-progress projects with progress blocks and covers, recent files, activity feed.

## [0.2.0] - 2026-09-11

- Nested category folders in the sidebar (Furniture/2nd Bedroom/Project).
- Settings is a full page: library and NAS paths, theme, six accent colours, layout, updates and about, library health check, maintenance.
- Preview pane hides until a file is selected; close with the X or Esc.
- Layout switch in the top bar: preview beside or below the file grid.
- Tools page with an add-in registry. First add-in: Drawing Sheets, title and divider pages as PDF (Letter or Ledger, portrait or landscape) saved to disk or straight into a project.
- Project progress is ten blocks instead of a slider.
- Export tab: zip the whole project with older versions, thumbnails, project.json and a README.
- Versions shown as a v1 → v2 → v3 timeline; click a version to view it, add a note, open it, or delete it.
- 3MF files from Bambu Studio and PrusaSlicer render in the 3D viewer.
- Backup dialog shows a progress bar.

## [0.1.0] - 2026-09-10

First working build.

- Projects with category folders, status, progress, tags, description, notes,
  custom fields, and history.
- Files copied into the library; versions by re-adding the same filename;
  per-version notes; drag and drop; folder import.
- Previews and extracted data for Fusion 360, Inventor, SolidWorks (unverified),
  FreeCAD, STL/OBJ/3MF (rendered, with interactive 3D viewer), STEP, DXF,
  G-code, KiCad, photos, videos, PDF, Office documents.
- Missing-component warning for assemblies.
- Search across everything, including document text.
- One-way NAS backup with reason-required deletions moved to `_Deleted/` and
  logged; optional backup on quit.
- Silent auto-update from GitHub Releases.
