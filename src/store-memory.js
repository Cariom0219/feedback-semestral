/**
 * Armazenamento em memória (demonstração no navegador e testes automáticos).
 * Implementa a mesma interface do armazenamento em Planilha Google usado em produção.
 */
var Sha256 = (function () {
  'use strict';
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  return function sha256(texto) {
    var bytes = utf8(String(texto));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        W[t] = (bytes[off + t * 4] << 24) | (bytes[off + t * 4 + 1] << 16) | (bytes[off + t * 4 + 2] << 8) | bytes[off + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  };
})();

function MemoryStore(estadoInicial, opcoes) {
  'use strict';
  opcoes = opcoes || {};
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function vazio() {
    return { config: {}, pessoas: [], criterios: [], participacao: [], up: [], down: [], agenda: [], logs: [], cache: {}, segredo: '' };
  }
  var st = Object.assign(vazio(), clone(estadoInicial) || {});
  if (!st.segredo) st.segredo = uuid() + uuid();
  var relogio = opcoes.relogio || function () { return new Date(); };

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function salvar() { if (opcoes.persistir) { try { opcoes.persistir(st); } catch (e) { /* armazenamento indisponível */ } } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dataLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  return {
    _estado: function () { return st; },
    getConfig: function () { return clone(st.config); },
    setConfig: function (o) { Object.keys(o).forEach(function (k) { st.config[k] = clone(o[k]); }); salvar(); },
    listPessoas: function () { return clone(st.pessoas); },
    salvarPessoa: function (p) {
      var i = -1;
      st.pessoas.forEach(function (x, j) { if (x.mat === p.mat) i = j; });
      if (i >= 0) st.pessoas[i] = clone(p); else st.pessoas.push(clone(p));
      salvar();
    },
    substituirPessoas: function (lista) { st.pessoas = clone(lista); salvar(); },
    listCriterios: function () { return clone(st.criterios); },
    salvarCriterios: function (lista) { st.criterios = clone(lista); salvar(); },
    listParticipacao: function (ciclo) {
      return clone(st.participacao.filter(function (x) { return !ciclo || x.ciclo === ciclo; }));
    },
    addParticipacao: function (r) { st.participacao.push(clone(r)); salvar(); },
    listUp: function (ciclo) { return clone(st.up.filter(function (x) { return !ciclo || x.ciclo === ciclo; })); },
    addUp: function (r) { st.up.push(clone(r)); salvar(); },
    listDown: function (ciclo) { return clone(st.down.filter(function (x) { return !ciclo || x.ciclo === ciclo; })); },
    saveDown: function (r) {
      var i = -1;
      st.down.forEach(function (x, j) { if (x.id === r.id) i = j; });
      if (i >= 0) st.down[i] = clone(r); else st.down.push(clone(r));
      salvar();
    },
    listAgenda: function (ciclo) { return clone(st.agenda.filter(function (x) { return !ciclo || x.ciclo === ciclo; })); },
    salvarAgenda: function (r) {
      var i = -1;
      st.agenda.forEach(function (x, j) { if (x.id === r.id) i = j; });
      if (i >= 0) st.agenda[i] = clone(r); else st.agenda.push(clone(r));
      salvar();
    },
    log: function (mat, evento, detalhe) {
      st.logs.push({ em: relogio().toISOString(), mat: mat, evento: evento, detalhe: detalhe || '' });
      if (st.logs.length > 300) st.logs.splice(0, st.logs.length - 300);
      salvar();
    },
    cacheGet: function (k) {
      var e = st.cache[k];
      if (!e) return null;
      if (e.exp < relogio().getTime()) { delete st.cache[k]; return null; }
      return e.v;
    },
    cachePut: function (k, v, seg) { st.cache[k] = { v: String(v), exp: relogio().getTime() + seg * 1000 }; salvar(); },
    cacheDel: function (k) { delete st.cache[k]; salvar(); },
    hash: function (s) { return Sha256(s); },
    segredo: function () { return st.segredo; },
    uuid: uuid,
    hoje: function () { return dataLocal(relogio()); },
    agora: function () { return relogio().toISOString().slice(0, 19); },
    comTrava: function (fn) { return fn(); },
    erro: function (e) { if (typeof console !== 'undefined') console.error(e); }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MemoryStore: MemoryStore, Sha256: Sha256 };
