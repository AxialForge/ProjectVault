// "Drawing sheets" add-in, main-process half: render an HTML page to PDF at
// Letter or Ledger size using a hidden BrowserWindow. Returns PDF bytes.
const { BrowserWindow } = require("electron");

const SIZES = {
  letter: { width: 8.5, height: 11 },
  ledger: { width: 11, height: 17 },
};

async function htmlToPdf(html, { size = "letter", landscape = false } = {}) {
  const s = SIZES[size] || SIZES.letter;
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    return await win.webContents.printToPDF({
      pageSize: { width: s.width, height: s.height },
      landscape,
      printBackground: true,
      margins: { marginType: "none" },
      preferCSSPageSize: false,
    });
  } finally {
    win.destroy();
  }
}

module.exports = { htmlToPdf, SIZES };
