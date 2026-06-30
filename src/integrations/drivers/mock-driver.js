// ============================================================
// NodeFlow — Mock driver para el motor de recetas (tests / dry-run)
// Registra todas las acciones y permite guionizar qué selectores
// "existen" y qué texto tiene la página. Sin navegador real.
// ============================================================
'use strict';

class MockDriver {
  /**
   * @param {object} cfg
   * @param {string[]} [cfg.present]  - selectores que SÍ existen
   * @param {string}   [cfg.pageText] - texto que devuelve pageText()
   * @param {object}   [cfg.texts]    - { selector: textoDevueltoPorGetText }
   */
  constructor(cfg = {}) {
    this.present = new Set(cfg.present || []);
    this.allPresent = cfg.allPresent === true; // modo permisivo: todo "existe"
    this._pageText = cfg.pageText || '';
    this.texts = cfg.texts || {};
    this.actions = []; // historial: { op, selector?, value?, url? }
  }
  async exists(sel) { return this.allPresent || this.present.has(sel); }
  async goto(url) { this.actions.push({ op: 'goto', url }); }
  async click(sel) { this.actions.push({ op: 'click', selector: sel }); }
  async fill(sel, value) { this.actions.push({ op: 'fill', selector: sel, value }); }
  async selectOption(sel, value) { this.actions.push({ op: 'select', selector: sel, value }); }
  async waitFor(sel) { this.actions.push({ op: 'waitFor', selector: sel }); }
  async getText(sel) { this.actions.push({ op: 'getText', selector: sel }); return this.texts[sel] || ''; }
  async pageText() { return this._pageText; }
  async screenshot(name) { this.actions.push({ op: 'screenshot', name }); return `mock://shot/${name}`; }

  /** Helpers para tests */
  filledValue(field) { return this.actions.find(a => a.op === 'fill' && a.selector === field)?.value; }
  didClick(sel) { return this.actions.some(a => a.op === 'click' && a.selector === sel); }
}

module.exports = { MockDriver };
