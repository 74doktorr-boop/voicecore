// ============================================================
// NodeFlow — Driver real de navegador (Playwright / Chromium headless)
// Implementa el contrato que usa el motor de recetas. Playwright se carga
// de forma PEREZOSA: el módulo se puede importar sin tenerlo instalado
// (los tests usan MockDriver). Solo el worker de integraciones necesita
// `npm i playwright` + navegadores. No se mete en el backend de voz.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Logger } = require('../../utils/logger');
const log = new Logger('RPA-PW');

class PlaywrightDriver {
  constructor(browser, context, page, opts) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.shotDir = opts.shotDir;
    this.actionTimeout = opts.actionTimeout || 12000;
  }

  /** Lanza Chromium headless y abre una página. */
  static async launch(opts = {}) {
    let chromium;
    try {
      ({ chromium } = require('playwright'));
    } catch (e) {
      throw new Error('Playwright no instalado. En el worker de integraciones: `npm i playwright && npx playwright install chromium`.');
    }
    const browser = await chromium.launch({ headless: opts.headless !== false });
    const context = await browser.newContext({
      locale: 'es-ES',
      userAgent: opts.userAgent, // por defecto el de Chromium
      storageState: opts.storageState, // reutilizar sesión si la pasamos
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.actionTimeout || 12000);
    const shotDir = opts.shotDir || path.join(os.tmpdir(), 'nodeflow-rpa-evidence');
    try { fs.mkdirSync(shotDir, { recursive: true }); } catch (_) {}
    return new PlaywrightDriver(browser, context, page, { ...opts, shotDir });
  }

  async exists(sel) {
    try { return (await this.page.locator(sel).count()) > 0; }
    catch { return false; }
  }
  async goto(url) { await this.page.goto(url, { waitUntil: 'domcontentloaded' }); }
  async click(sel) { await this.page.locator(sel).first().click({ timeout: this.actionTimeout }); }
  async fill(sel, value) { await this.page.locator(sel).first().fill(String(value), { timeout: this.actionTimeout }); }
  async selectOption(sel, value) {
    // Intenta por etiqueta visible, luego por value.
    const loc = this.page.locator(sel).first();
    try { await loc.selectOption({ label: String(value) }, { timeout: this.actionTimeout }); }
    catch { await loc.selectOption(String(value), { timeout: this.actionTimeout }); }
  }
  async waitFor(sel, timeout) { await this.page.locator(sel).first().waitFor({ timeout: timeout || this.actionTimeout }); }
  async getText(sel) { return (await this.page.locator(sel).first().innerText({ timeout: this.actionTimeout })); }
  async pageText() { try { return await this.page.locator('body').innerText(); } catch { return await this.page.content(); } }
  async screenshot(name) {
    const safe = String(name).replace(/[^\w.-]+/g, '_');
    const file = path.join(this.shotDir, `${Date.now()}-${safe}.png`);
    try { await this.page.screenshot({ path: file, fullPage: true }); return file; }
    catch (e) { log.warn(`screenshot falló: ${e.message}`); return null; }
  }
  /** Devuelve el estado de sesión (cookies/localStorage) para reutilizar login. */
  async exportSession() { try { return await this.context.storageState(); } catch { return null; } }
  async close() { try { await this.browser.close(); } catch (_) {} }
}

module.exports = { PlaywrightDriver };
