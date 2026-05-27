// ============================================
// NodeFlow — Google Sheets sync helper
// Usa Service Account para escribir sin OAuth
// ============================================

const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');

const SHEET_HEADERS = [
  'nombre', 'sector', 'ciudad', 'telefono', 'address', 'rating', 'reviews',
  'website', 'maps_url', 'wa_link', 'wa_mensaje', 'estado', 'notas', 'fecha_contacto', 'fecha_añadido',
];

function getAuth() {
  const keyPath    = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const keyInline  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let credentials;

  if (keyInline) {
    try {
      credentials = JSON.parse(
        Buffer.from(keyInline, 'base64').toString('utf-8')
      );
    } catch {
      credentials = JSON.parse(keyInline);
    }
  } else if (keyPath) {
    const fullPath = path.isAbsolute(keyPath)
      ? keyPath
      : path.join(process.cwd(), keyPath);
    credentials = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  } else {
    return null;
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Appends rows to the sheet, skipping duplicates (by nombre+ciudad).
 * Creates the header row if the sheet is empty.
 * Returns { added, skipped }.
 */
async function appendLeadsToSheet(leads) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const auth = getAuth();

  if (!spreadsheetId || !auth) {
    return { ok: false, reason: 'not_configured' };
  }

  const sheets = google.sheets({ version: 'v4', auth });
  const range  = 'Leads!A1:Z';

  // ── Leer filas existentes ──────────────────────────────────────────────────
  let existingKeys = new Set();
  let hasHeader    = false;

  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values || [];

    if (rows.length > 0) {
      // Primera fila = cabeceras
      const hdr = rows[0];
      const iNombre = hdr.indexOf('nombre');
      const iCiudad = hdr.indexOf('ciudad');

      if (iNombre !== -1) {
        hasHeader = true;
        for (const row of rows.slice(1)) {
          const key = `${(row[iNombre] || '').toLowerCase()}|${(row[iCiudad] || '').toLowerCase()}`;
          existingKeys.add(key);
        }
      }
    }
  } catch (e) {
    // Sheet vacío o sin permisos — continuamos
  }

  // ── Preparar filas nuevas ──────────────────────────────────────────────────
  const now    = new Date().toLocaleDateString('es-ES');
  const toAdd  = [];

  for (const lead of leads) {
    const key = `${lead.nombre.toLowerCase()}|${lead.ciudad.toLowerCase()}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key); // evitar duplicados dentro del mismo batch

    toAdd.push([
      lead.nombre, lead.sector, lead.ciudad, lead.telefono, lead.address,
      lead.rating, lead.reviews, lead.website, lead.maps_url,
      lead.wa_link, lead.wa_mensaje, '', '', '', now,
    ]);
  }

  if (toAdd.length === 0) {
    return { ok: true, added: 0, skipped: leads.length };
  }

  // ── Escribir cabeceras si la hoja está vacía ───────────────────────────────
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:          'Leads!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS] },
    });

    // Formato bold en cabeceras
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetId = meta.data.sheets.find(s => s.properties.title === 'Leads')?.properties?.sheetId ?? 0;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.2, green: 0.2, blue: 0.6 } } },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          }],
        },
      });
    } catch (_) { /* cosmético, no crítico */ }
  }

  // ── Append ─────────────────────────────────────────────────────────────────
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range:            'Leads!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: toAdd },
  });

  return { ok: true, added: toAdd.length, skipped: leads.length - toAdd.length };
}

module.exports = { appendLeadsToSheet };
