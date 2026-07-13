#!/usr/bin/env node
// scripts/generate-guia-pdf.js
// Pre-genera el PDF estático de la guía de bienvenida a partir de public/guia.html.
//
// El PDF (public/guia-nodeflow.pdf) se adjunta en el email de bienvenida
// (src/notifications/email.js → sendWelcomePortalEmail) además del enlace web.
//
// ⚠️ Regenera el PDF cada vez que cambies public/guia.html:
//     node scripts/generate-guia-pdf.js   (o: npm run guia:pdf)
//
// No usa puppeteer/playwright para no meter Chromium en la imagen de runtime:
// invoca directamente el Chrome/Edge del sistema en modo headless --print-to-pdf.
// Define CHROME_PATH si tu navegador está en una ruta no estándar.

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'public', 'guia.html');
const OUT  = path.join(ROOT, 'public', 'guia-nodeflow.pdf');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`✖ No existe ${SRC}`);
    process.exit(1);
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error('✖ No se encontró Chrome/Edge. Instala Chrome o define CHROME_PATH.');
    process.exit(1);
  }

  // file:// URL con separadores POSIX (Chrome lo acepta en todas las plataformas)
  const fileUrl = 'file:///' + SRC.replace(/\\/g, '/');

  console.log(`→ Chrome: ${chrome}`);
  console.log(`→ Fuente: ${SRC}`);

  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',   // sin cabeceras/pies de página automáticos
    `--print-to-pdf=${OUT}`,    // Chrome usa emulación de media "print" por defecto
    fileUrl,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  if (!fs.existsSync(OUT)) {
    console.error('✖ Chrome no generó el PDF.');
    process.exit(1);
  }

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`✔ PDF generado: ${OUT} (${kb} KB)`);
}

main();
