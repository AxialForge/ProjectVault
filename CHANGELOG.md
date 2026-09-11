# Changelog

All notable changes to this project are documented here.

## [Unreleased]

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
