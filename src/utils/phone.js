// ============================================================
// NodeFlow — Utilidad canónica de teléfonos (ES)
// ------------------------------------------------------------
// Proveedores de telefonía y usuarios escriben el mismo número en
// formatos distintos (+34, 0034, con/sin espacios, nacional). Para
// COMPARAR o BUSCAR contactos hay que reducirlos a una forma canónica.
// Antes cada sitio tenía su propia normalización → el mismo número no
// casaba (p.ej. el E.164 de la llamada no encontraba el contacto que el
// portal guardó como nacional → no reconocía al cliente que vuelve).
// ============================================================
'use strict';

/**
 * Reduce un teléfono a su número NACIONAL de 9 dígitos (ES).
 * "+34 843 98 76 54" | "34843987654" | "0034843987654" | "843987654" → "843987654"
 * @param {string} raw
 * @returns {string} 9 dígitos (o menos si el input era corto); '' si vacío.
 */
function normalizePhone(raw = '') {
  let p = String(raw || '').replace(/\D/g, '');
  if (p.startsWith('0034')) p = p.slice(4);
  if (p.startsWith('34') && p.length === 11) p = p.slice(2);
  return p.replace(/^0+/, '');
}

/**
 * Todas las formas plausibles de un número, para un `.in('phone', …)` de Supabase
 * (los contactos pueden estar guardados en cualquiera de ellas).
 * @param {string} raw
 * @returns {string[]} variantes únicas y no vacías.
 */
function phoneVariants(raw = '') {
  const original = String(raw || '').trim();
  const n9 = normalizePhone(raw);
  const set = new Set();
  if (original) set.add(original);
  if (n9) {
    set.add(n9);
    set.add(`+34${n9}`);
    set.add(`34${n9}`);
    set.add(`0034${n9}`);
    set.add(`+34 ${n9}`);
  }
  return [...set];
}

module.exports = { normalizePhone, phoneVariants };
