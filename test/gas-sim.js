// Simulador mínimo do Google Apps Script para testar Code.gs + Core.gs no Node.
// Reproduz os limites que costumam quebrar scripts reais: faixa fora da planilha,
// texto que vira fórmula, números de dígito convertidos e assinatura de bytes do digest.
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function criarAmbiente({ ativa = true } = {}) {
  const planilhas = {};
  let seq = 0;

  class Range {
    constructor(sh, r, c, nr, nc) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`Faixa inválida ${r},${c},${nr},${nc}`);
      if (r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols) {
        throw new Error(`The coordinates of the range are outside the dimensions of the sheet (${sh.nome}: ${r + nr - 1}x${c + nc - 1} > ${sh.maxRows}x${sh.maxCols})`);
      }
      Object.assign(this, { sh, r, c, nr, nc });
    }
    _cel(i, j) { return (this.sh.dados[this.r - 1 + i] || [])[this.c - 1 + j]; }
    getValues() { return this.getDisplayValues(); }
    getDisplayValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const l = [];
        for (let j = 0; j < this.nc; j++) { const v = this._cel(i, j); l.push(v == null ? '' : String(v)); }
        out.push(l);
      }
      return out;
    }
    setValues(vals) {
      if (vals.length !== this.nr || vals.some((l) => l.length !== this.nc)) throw new Error('setValues: dimensões diferentes da faixa');
      vals.forEach((l, i) => l.forEach((v, j) => {
        const lin = this.r - 1 + i;
        while (this.sh.dados.length <= lin) this.sh.dados.push([]);
        let s = v == null ? '' : String(v);
        if (/^=/.test(s)) s = '#FORMULA:' + s; // texto que viraria fórmula
        const fmt = this.sh.formato[`${lin}:${this.c - 1 + j}`];
        if (fmt !== '@' && /^\d{4}-\d{1,2}$/.test(s)) s = '#DATA:' + s; // "2026-2" viraria data
        if (fmt !== '@' && /^0\d+$/.test(s)) s = String(Number(s)); // perderia zeros à esquerda
        this.sh.dados[lin][this.c - 1 + j] = s;
      }));
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setNumberFormat(f) {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.formato[`${this.r - 1 + i}:${this.c - 1 + j}`] = f;
      return this;
    }
    clearContent() {
      for (let i = 0; i < this.nr; i++) {
        const l = this.sh.dados[this.r - 1 + i];
        if (l) for (let j = 0; j < this.nc; j++) l[this.c - 1 + j] = '';
      }
      return this;
    }
    setFontWeight() { return this; }
    setBackground() { return this; }
    setFontColor() { return this; }
    setNote(n) { this.sh.nota = n; return this; }
  }

  class Sheet {
    constructor(nome) { Object.assign(this, { nome, dados: [], maxRows: 1000, maxCols: 26, formato: {} }); }
    getName() { return this.nome; }
    getLastRow() {
      for (let i = this.dados.length - 1; i >= 0; i--) if ((this.dados[i] || []).some((v) => v !== '' && v != null)) return i + 1;
      return 0;
    }
    getLastColumn() {
      let m = 0;
      this.dados.forEach((l) => (l || []).forEach((v, j) => { if (v !== '' && v != null) m = Math.max(m, j + 1); }));
      return m;
    }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    insertRowsAfter(_, n) { this.maxRows += n; }
    insertColumnsAfter(_, n) { this.maxCols += n; }
    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        const m = /^([A-Z]+)(\d+)$/.exec(a);
        return new Range(this, Number(m[2]), m[1].charCodeAt(0) - 64, 1, 1);
      }
      return new Range(this, a, b, c || 1, d || 1);
    }
    setFrozenRows() {}
    clearContents() { this.dados = []; return this; }
  }

  class Spreadsheet {
    constructor(nome) { this.id = 'ss' + (++seq); this.nome = nome; this.abas = [new Sheet('Página1')]; planilhas[this.id] = this; }
    getId() { return this.id; }
    getSheetByName(n) { return this.abas.find((s) => s.nome === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.abas.push(s); return s; }
    getSheets() { return this.abas.slice(); }
    deleteSheet(s) { this.abas = this.abas.filter((x) => x !== s); }
  }

  const vinculada = new Spreadsheet('Feedback (vinculada)');
  const props = {};
  const cacheMap = new Map();
  const ui = { respostas: [], alertas: [], botoes: [] };
  const relogio = { agora: Date.parse('2026-11-18T15:00:00Z') };

  const g = {
    console: { log() {}, error: (...a) => { g.__erros.push(a.map(String).join(' ')); } },
    __erros: [],
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (g.__ativa ? vinculada : null),
      openById: (id) => { if (!planilhas[id]) throw new Error('planilha inexistente'); return planilhas[id]; },
      create: (n) => new Spreadsheet(n),
      flush() {},
      getUi: () => {
        if (!g.__ui) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
        return {
          ButtonSet: { OK_CANCEL: 'OK_CANCEL', YES_NO_CANCEL: 'YES_NO_CANCEL' },
          Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
          prompt: () => {
            const r = ui.respostas.shift();
            return { getSelectedButton: () => (r === null ? 'CANCEL' : 'OK'), getResponseText: () => r || '' };
          },
          alert: (titulo, msg, botoes) => {
            ui.alertas.push(msg ? `${titulo}: ${msg}` : titulo);
            return botoes ? ui.botoes.shift() || 'NO' : 'OK';
          },
          createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; }
        };
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => {
          if (String(v).length > 9000) throw new Error('Argumento grande demais para a propriedade');
          props[k] = String(v);
        },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => ({ ...props })
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cacheMap.get(k); if (!e || e.exp < relogio.agora) return null; return e.v; },
        put: (k, v, ttl) => {
          if (ttl > 21600) throw new Error('TTL acima de 6 horas');
          if (k.length > 250) throw new Error('chave longa');
          cacheMap.set(k, { v: String(v), exp: relogio.agora + ttl * 1000 });
        },
        remove: (k) => cacheMap.delete(k)
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
          .formatToParts(new Date(relogio.agora)).map((x) => [x.type, x.value]));
        if (fmt === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
        return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
      }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: (n) => {
        const o = { arquivo: n, meta: {}, setTitle: (t) => { o.titulo = t; return o; }, addMetaTag: (k, v) => { o.meta[k] = v; return o; }, setXFrameOptionsMode: (m) => { o.xframe = m; return o; } };
        return o;
      }
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTE/exec' }) },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: (t) => { const o = { texto: String(t), mime: 'text/plain', setMimeType: (m) => { o.mime = m; return o; } }; return o; }
    }
  };
  g.__ativa = ativa;
  g.__ui = true;
  vm.createContext(g);
  return { g, vinculada, props, cacheMap, ui, relogio, planilhas };
}

function carregar(env, arquivos) {
  for (const f of arquivos) vm.runInContext(fs.readFileSync(f, 'utf8'), env.g, { filename: f });
  return env.g;
}

module.exports = { criarAmbiente, carregar };
