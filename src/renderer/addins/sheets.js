// Add-in: Drawing Sheets. Builds title pages and divider pages for drawing
// sets as PDFs, Letter or Ledger, portrait or landscape. The page is plain
// HTML rendered to PDF by the main process; the same HTML drives the live
// preview here.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SIZES = { letter: [8.5, 11], ledger: [11, 17] };

function pageHtml(f) {
  const [w, h] = SIZES[f.size] || SIZES.letter;
  const pw = f.landscape ? h : w, ph = f.landscape ? w : h;
  const accent = f.accent || "#1f2a44";
  const dateStr = f.date ? new Date(f.date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  const body =
    f.type === "divider"
      ? `<div class="divider">
          <div class="band"></div>
          <div class="sec-no">${esc(f.section)}</div>
          <div class="sec-title">${esc(f.title)}</div>
          ${f.subtitle ? `<div class="sec-sub">${esc(f.subtitle)}</div>` : ""}
          ${f.notes ? `<div class="sec-notes">${esc(f.notes).replace(/\n/g, "<br>")}</div>` : ""}
        </div>`
      : `<div class="title">
          <div class="band"></div>
          <div class="kicker">${esc(f.kicker || "Drawing set")}</div>
          <h1>${esc(f.title)}</h1>
          ${f.subtitle ? `<div class="sub">${esc(f.subtitle)}</div>` : ""}
          ${f.notes ? `<div class="desc">${esc(f.notes).replace(/\n/g, "<br>")}</div>` : ""}
          <table class="block">
            <tr><td>Project</td><td>${esc(f.project)}</td></tr>
            <tr><td>Drawn by</td><td>${esc(f.author)}</td></tr>
            <tr><td>Date</td><td>${esc(dateStr)}</td></tr>
            <tr><td>Revision</td><td>${esc(f.revision)}</td></tr>
            <tr><td>Sheets</td><td>${esc(f.sheets)}</td></tr>
            ${f.scale ? `<tr><td>Scale / units</td><td>${esc(f.scale)}</td></tr>` : ""}
          </table>
        </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${pw}in ${ph}in; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${pw}in; height: ${ph}in; background: #fff; color: #111; font-family: "Segoe UI", Arial, sans-serif; }
    .title, .divider { position: relative; width: ${pw}in; height: ${ph}in; box-sizing: border-box; padding: 0.9in 0.9in 0.8in; overflow: hidden; }
    .band { position: absolute; left: 0; top: 0; bottom: 0; width: 0.45in; background: ${accent}; }
    .kicker { margin-left: 0.3in; font-size: 11pt; letter-spacing: 0.25em; text-transform: uppercase; color: ${accent}; }
    h1 { margin: 0.15in 0 0.1in 0.3in; font-size: ${f.landscape ? 34 : 30}pt; font-weight: 700; line-height: 1.1; }
    .sub { margin-left: 0.3in; font-size: 15pt; color: #444; }
    .desc { margin: 0.35in 0 0 0.3in; font-size: 11pt; line-height: 1.5; color: #333; max-width: ${pw - 2.4}in; }
    .block { position: absolute; left: 1.2in; right: 0.9in; bottom: 0.8in; border-collapse: collapse; font-size: 11pt; }
    .block td { border-top: 1px solid #999; padding: 6pt 8pt; }
    .block td:first-child { width: 1.6in; color: #666; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; }
    .block tr:last-child td { border-bottom: 1px solid #999; }
    .divider .sec-no { margin-left: 0.3in; margin-top: ${ph * 0.25}in; font-size: 60pt; font-weight: 800; color: ${accent}; line-height: 1; }
    .divider .sec-title { margin-left: 0.3in; font-size: ${f.landscape ? 34 : 30}pt; font-weight: 700; margin-top: 0.1in; }
    .divider .sec-sub { margin-left: 0.3in; font-size: 14pt; color: #555; margin-top: 0.1in; }
    .divider .sec-notes { margin: 0.4in 0 0 0.3in; font-size: 11pt; line-height: 1.5; color: #333; }
    .foot { position: absolute; left: 1.2in; bottom: 0.4in; font-size: 8pt; color: #888; }
  </style></head><body>${body}<div class="foot">${esc(f.project)}${f.title ? " · " + esc(f.title) : ""}${f.revision ? " · Rev " + esc(f.revision) : ""}</div></body></html>`;
}

export default {
  id: "sheets",
  name: "Drawing Sheets",
  icon: "▤",
  blurb: "Title pages and section dividers for drawing sets. Letter or Ledger, PDF.",
  render(container, ctx) {
    const p = ctx.project;
    const f = {
      type: "title", size: "letter", landscape: false, accent: "#1f2a44",
      project: p?.name || "", title: p?.name || "", subtitle: p?.description || "", kicker: "Drawing set",
      author: "", date: new Date().toISOString().slice(0, 10), revision: "A", sheets: "", scale: "", section: "01", notes: "",
    };
    const projectOpts = ctx.projects.map((x) => `<option value="${x.id}" ${p && x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    container.innerHTML = `<div class="tool">
      <div class="form">
        <div class="row" style="margin-bottom:10px"><div class="seg" id="sh-type"><button data-v="title" class="active">Title page</button><button data-v="divider">Divider</button></div>
          <div class="seg" id="sh-size"><button data-v="letter" class="active">Letter</button><button data-v="ledger">Ledger</button></div>
          <div class="seg" id="sh-orient"><button data-v="0" class="active">Portrait</button><button data-v="1">Landscape</button></div></div>
        <div class="field"><label>For project</label><select id="sh-proj"><option value="">(none)</option>${projectOpts}</select></div>
        <div class="field"><label>Project name on sheet</label><input id="sh-project" value="${esc(f.project)}"></div>
        <div class="field"><label>Title</label><input id="sh-title" value="${esc(f.title)}"></div>
        <div class="field"><label>Subtitle</label><input id="sh-subtitle" value="${esc(f.subtitle)}"></div>
        <div class="field" data-only="title"><label>Kicker (small text above title)</label><input id="sh-kicker" value="${esc(f.kicker)}"></div>
        <div class="field" data-only="divider"><label>Section number</label><input id="sh-section" value="${esc(f.section)}"></div>
        <div class="row" data-only="title"><div class="field" style="flex:1"><label>Drawn by</label><input id="sh-author"></div><div class="field" style="flex:1"><label>Date</label><input type="date" id="sh-date" value="${f.date}"></div></div>
        <div class="row" data-only="title"><div class="field" style="flex:1"><label>Revision</label><input id="sh-revision" value="A"></div><div class="field" style="flex:1"><label>Sheet count</label><input id="sh-sheets" placeholder="e.g. 6"></div><div class="field" style="flex:1"><label>Scale / units</label><input id="sh-scale" placeholder="1:1, inches"></div></div>
        <div class="field"><label>Description / notes</label><textarea id="sh-notes" rows="3"></textarea></div>
        <div class="field"><label>Accent colour</label><input type="color" id="sh-accent" value="${f.accent}" style="width:60px;height:32px;padding:2px"></div>
        <div class="row"><button class="btn primary" id="sh-add" ${p ? "" : "disabled"} title="${p ? "Save into " + esc(p.name) : "Open a project first"}">Add PDF to project</button><button class="btn" id="sh-save">Save PDF as…</button></div>
        <p class="dim small">Sheets are added to the selected project as a normal file, so they get versions like anything else.</p>
      </div>
      <div class="sheet-preview" id="sh-preview"><iframe id="sh-frame" sandbox=""></iframe></div>
    </div>`;
    const $ = (s) => container.querySelector(s);
    const read = () => {
      f.project = $("#sh-project").value; f.title = $("#sh-title").value; f.subtitle = $("#sh-subtitle").value; f.kicker = $("#sh-kicker").value;
      f.section = $("#sh-section").value; f.author = $("#sh-author").value; f.date = $("#sh-date").value; f.revision = $("#sh-revision").value;
      f.sheets = $("#sh-sheets").value; f.scale = $("#sh-scale").value; f.notes = $("#sh-notes").value; f.accent = $("#sh-accent").value;
    };
    const fit = () => {
      const [w, h] = SIZES[f.size];
      const pw = f.landscape ? h : w, ph = f.landscape ? w : h;
      const box = $("#sh-preview");
      const scale = Math.min((box.clientWidth - 32) / (pw * 96), (box.clientHeight - 32) / (ph * 96), 1);
      const fr = $("#sh-frame");
      fr.style.width = pw * 96 + "px";
      fr.style.height = ph * 96 + "px";
      fr.style.transform = `scale(${scale})`;
      fr.style.transformOrigin = "center";
      fr.style.margin = `${-(ph * 96 * (1 - scale)) / 2}px ${-(pw * 96 * (1 - scale)) / 2}px`;
    };
    const update = () => {
      read();
      container.querySelectorAll("[data-only]").forEach((el) => el.classList.toggle("hidden", el.dataset.only !== f.type));
      $("#sh-frame").srcdoc = pageHtml(f);
      fit();
    };
    for (const [id, key] of [["#sh-type", "type"], ["#sh-size", "size"], ["#sh-orient", "landscape"]])
      $(id).querySelectorAll("button").forEach((b) => (b.onclick = () => { $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); f[key] = key === "landscape" ? b.dataset.v === "1" : b.dataset.v; update(); }));
    container.querySelectorAll("input, textarea").forEach((i) => i.addEventListener("input", update));
    $("#sh-proj").onchange = () => {
      const sel = ctx.projects.find((x) => String(x.id) === $("#sh-proj").value);
      ctx.project = sel || null;
      $("#sh-add").disabled = !sel;
      if (sel) { $("#sh-project").value = sel.name; if (!$("#sh-title").value) $("#sh-title").value = sel.name; }
      update();
    };
    const filename = () => `${(f.type === "divider" ? "Divider " + f.section + " " : "Title ") + (f.title || "sheet")}.pdf`.replace(/[<>:"/\\|?*]/g, "-");
    $("#sh-save").onclick = async () => {
      read();
      const r = await ctx.api.sheetSave({ html: pageHtml(f), opts: { size: f.size, landscape: f.landscape }, filename: filename() });
      if (r?.path) ctx.toast("Saved " + r.path, "ok");
    };
    $("#sh-add").onclick = async () => {
      read();
      const r = await ctx.api.sheetSave({ html: pageHtml(f), opts: { size: f.size, landscape: f.landscape }, projectId: ctx.project.id, filename: filename() });
      if (r?.item) { ctx.toast(`Added ${r.item.name} to ${ctx.project.name}`, "ok"); ctx.refresh(); }
    };
    new ResizeObserver(fit).observe($("#sh-preview"));
    update();
  },
};
