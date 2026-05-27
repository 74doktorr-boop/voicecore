// ============================================================
// NodeFlow — Google Apps Script (pegar en el Sheet)
// Extensions → Apps Script → pegar esto → Deploy as Web App
// ============================================================
// Recibe leads via POST y los añade sin duplicar.
// URL resultante → añadir a .env como GOOGLE_APPS_SCRIPT_URL
// ============================================================

const SHEET_NAME = 'Leads';
const HEADERS = [
  'nombre','sector','ciudad','telefono','dirección','rating','reseñas',
  'website','maps_url','wa_link','wa_mensaje','estado','notas','fecha_contacto','fecha_añadido'
];

function doPost(e) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    // Cabeceras si la hoja está vacía
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      const hdrRange = sheet.getRange(1, 1, 1, HEADERS.length);
      hdrRange.setFontWeight('bold')
              .setBackground('#1a1a5e')
              .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    const data  = JSON.parse(e.postData.contents);
    const leads = data.leads || [];

    // Claves existentes (nombre+ciudad) para deduplicar
    const lastRow = sheet.getLastRow();
    const existingKeys = new Set();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 3).getValues().forEach(row => {
        existingKeys.add(`${String(row[0]).toLowerCase()}|${String(row[2]).toLowerCase()}`);
      });
    }

    const today = Utilities.formatDate(new Date(), 'Europe/Madrid', 'dd/MM/yyyy');
    let added = 0;

    leads.forEach(lead => {
      const key = `${(lead.nombre||'').toLowerCase()}|${(lead.ciudad||'').toLowerCase()}`;
      if (!existingKeys.has(key)) {
        sheet.appendRow([
          lead.nombre, lead.sector, lead.ciudad, lead.telefono,
          lead.address, lead.rating, lead.reviews, lead.website,
          lead.maps_url, lead.wa_link, lead.wa_mensaje,
          '', '', '', today
        ]);
        existingKeys.add(key);
        added++;
      }
    });

    // Formato condicional en columna "estado" (col 12)
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, added, skipped: leads.length - added }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Test manual desde el editor de Apps Script
function testPost() {
  const fake = {
    postData: {
      contents: JSON.stringify({ leads: [
        { nombre: 'Test Negocio', sector: 'restaurante', ciudad: 'Bilbao',
          telefono: '944000000', address: 'Calle Test 1', rating: '4.5',
          reviews: '120', website: '', maps_url: '', wa_link: '', wa_mensaje: 'Test' }
      ]})
    }
  };
  Logger.log(doPost(fake).getContent());
}
