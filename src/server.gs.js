/**
 * Feedback Semestral · Sirtec — servidor (Google Apps Script)
 *
 * Banco de dados: a Planilha Google onde este script está (Extensões → Apps Script).
 * Publicação: Implantar → Nova implantação → App da Web
 *             Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa
 *
 * As regras de acesso ficam no arquivo Core (FeedbackCore) e rodam aqui no servidor:
 * o navegador nunca recebe CPF, respostas de outras pessoas nem a lista completa de cadastro.
 */

var FUSO = 'America/Bahia';
var PROP_PLANILHA = 'FEEDBACK_PLANILHA_ID';
var PROP_SEGREDO = 'FEEDBACK_SEGREDO';
var PREFIXO_FILA = 'FBUP_';
var TAMANHO_LOTE = 5;

var ABA = {
  CONFIG: 'Config',
  PESSOAS: 'Pessoas',
  CRITERIOS: 'Criterios',
  PART: 'Participacao',
  UP: 'Resp_LideradoLider',
  DOWN: 'Resp_LiderLiderado',
  LOG: 'Log',
  IMPORTAR: 'Importar'
};

var CABECALHOS = {
  Config: ['Chave', 'Valor'],
  Pessoas: ['Matrícula', 'Nome', 'C.C', 'UTD', 'Matrícula do líder', 'Nome do líder', 'Perfil', 'Ativo', 'CPF (criptografado)', 'Atualizado em'],
  Criterios: ['ID', 'Formulário', 'Ordem', 'Texto', 'Ativo'],
  Participacao: ['Ciclo', 'Formulário', 'Matrícula avaliador', 'Nome avaliador', 'Matrícula avaliado', 'Nome avaliado', 'Data'],
  Resp_LideradoLider: ['ID', 'Ciclo', 'Matrícula do líder', 'Nome do líder', 'Média', 'Pontos fortes', 'Pontos fracos', 'Considerações finais'],
  Resp_LiderLiderado: ['ID', 'Ciclo', 'Matrícula do líder', 'Nome do líder', 'Matrícula do liderado', 'Nome do liderado', 'Data do feedback', 'Data da reavaliação', 'Média', 'Observações', 'Considerações finais', 'Enviado em', 'Atualizado em'],
  Log: ['Data/hora', 'Matrícula', 'Evento', 'Detalhe']
};

// ------------------------------------------------------------------ app da web

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Feedback Semestral · Sirtec')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Entrada para a página publicada fora do Apps Script (ex.: GitHub Pages).
 * A página envia {acao, dados, token} como texto (sem pré-verificação de CORS)
 * e recebe a mesma resposta JSON da função api().
 */
function doPost(e) {
  var corpo = {};
  try {
    corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {};
  } catch (err) {
    corpo = {};
  }
  var saida = api(corpo.acao, JSON.stringify(corpo.dados || {}), corpo.token || '');
  return ContentService.createTextOutput(saida).setMimeType(ContentService.MimeType.JSON);
}

/** Único ponto de entrada das regras (google.script.run.api ou doPost). */
function api(acao, dadosJson, token) {
  var dados;
  try {
    dados = dadosJson ? JSON.parse(dadosJson) : {};
  } catch (e) {
    return JSON.stringify({ ok: false, code: 'VALIDACAO', message: 'Dados inválidos.' });
  }
  var store;
  try {
    store = PlanilhaStore();
  } catch (e) {
    console.error(e);
    return JSON.stringify({ ok: false, code: 'CONFIG', message: 'O sistema ainda não foi configurado. Avise a coordenação.' });
  }
  return JSON.stringify(FeedbackCore.handle(store, String(acao || ''), dados, token ? String(token) : ''));
}

// ------------------------------------------------------------------ planilha

function planilha_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_PLANILHA);
  if (id) return SpreadsheetApp.openById(id);
  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (ativa) {
    props.setProperty(PROP_PLANILHA, ativa.getId());
    return ativa;
  }
  throw new Error('Planilha não configurada: abra a planilha e use o menu Feedback → 1. Preparar planilha.');
}

function segredo_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty(PROP_SEGREDO);
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(PROP_SEGREDO, s);
  }
  return s;
}

function sha256_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/** Evita que um texto digitado vire fórmula na planilha. */
function celula_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? ' ' + s : s;
}
function lerCelula_(v) {
  return String(v == null ? '' : v).replace(/^ (?=[=+\-@])/, '');
}
function numero_(v) {
  var s = String(v == null ? '' : v).trim().replace(',', '.');
  if (s === '') return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}
function simNao_(v) { return v ? 'SIM' : 'NÃO'; }
function ehNao_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s === 'NAO' || s === 'N' || s === 'FALSE' || s === 'FALSO' || s === '0' || s === 'INATIVO';
}
function lista_(v) {
  return lerCelula_(v).split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
}
function json_(v, padrao) {
  var s = lerCelula_(v).trim();
  if (!s) return padrao;
  try { return JSON.parse(s); } catch (e) { return padrao; }
}
function colunasNota_(cab) {
  var m = {};
  cab.forEach(function (h, i) {
    var id = String(h).split('·')[0].trim();
    if (/^L[LD]\d{2,}$/.test(id)) m[id] = i;
  });
  return m;
}
function embaralhar_(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function PlanilhaStore() {
  var ss = planilha_();
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var memo = {};
  var trava = 0;

  function aba(nome) {
    var sh = ss.getSheetByName(nome);
    if (!sh) throw new Error('A aba "' + nome + '" não existe. Use o menu Feedback → 1. Preparar planilha.');
    return sh;
  }

  function tabela(nome) {
    if (memo[nome]) return memo[nome];
    var sh = aba(nome);
    var lr = sh.getLastRow();
    var lc = Math.max(sh.getLastColumn(), (CABECALHOS[nome] || [1]).length);
    var vals = lr >= 1 ? sh.getRange(1, 1, lr, lc).getDisplayValues() : [];
    var cab = vals.length ? vals[0].map(String) : (CABECALHOS[nome] || []).slice();
    memo[nome] = { sh: sh, cab: cab, linhas: vals.slice(1) };
    return memo[nome];
  }

  function escrever(sh, linha, valores) {
    garantirTamanho_(sh, linha + valores.length - 1, valores[0].length);
    var r = sh.getRange(linha, 1, valores.length, valores[0].length);
    r.setNumberFormat('@');
    r.setValues(valores.map(function (l) { return l.map(celula_); }));
  }

  function acrescentar(nome, linhas) {
    if (!linhas.length) return;
    var sh = aba(nome);
    escrever(sh, sh.getLastRow() + 1, linhas);
    delete memo[nome];
  }

  function reescrever(nome, linhas) {
    var sh = aba(nome);
    var lr = sh.getLastRow();
    var lc = Math.max(sh.getLastColumn(), linhas.length ? linhas[0].length : 1);
    if (lr > 1) sh.getRange(2, 1, lr - 1, lc).clearContent();
    if (linhas.length) escrever(sh, 2, linhas);
    delete memo[nome];
  }

  /** Garante uma coluna por item avaliado (ex.: "LL03 · Escuta e abertura ao diálogo"). */
  function garantirColunasNota(nome, ids, criterios) {
    var t = tabela(nome);
    var mapa = colunasNota_(t.cab);
    var faltam = ids.filter(function (id) { return mapa[id] === undefined; });
    if (!faltam.length) return t;
    var textos = {};
    criterios.forEach(function (c) { textos[c.id] = c.texto; });
    var novos = faltam.sort().map(function (id) { return id + ' · ' + (textos[id] || ''); });
    var sh = t.sh;
    var inicio = t.cab.length + 1;
    garantirTamanho_(sh, 1, inicio + novos.length - 1);
    sh.getRange(1, inicio, 1, novos.length).setNumberFormat('@').setValues([novos]).setFontWeight('bold');
    delete memo[nome];
    return tabela(nome);
  }

  function linhaUp(r, t) {
    var mapa = colunasNota_(t.cab);
    var linha = [];
    for (var i = 0; i < t.cab.length; i++) linha.push('');
    linha[0] = r.id; linha[1] = r.ciclo; linha[2] = r.avaliado; linha[3] = r.avaliadoNome;
    linha[4] = r.media == null ? '' : String(r.media);
    linha[5] = (r.fortes || []).join('\n'); linha[6] = (r.fracos || []).join('\n'); linha[7] = r.consideracoes || '';
    Object.keys(r.notas || {}).forEach(function (k) { if (mapa[k] !== undefined) linha[mapa[k]] = String(r.notas[k]); });
    return linha;
  }

  function lerFila() {
    var todas = props.getProperties();
    return Object.keys(todas).filter(function (k) { return k.indexOf(PREFIXO_FILA) === 0; }).map(function (k) {
      try { return { chave: k, rec: JSON.parse(todas[k]) }; } catch (e) { return null; }
    }).filter(Boolean);
  }

  var store = {
    // ---- configuração
    getConfig: function () {
      var t = tabela(ABA.CONFIG);
      var o = {};
      t.linhas.forEach(function (l) { if (l[0]) o[l[0]] = json_(l[1], lerCelula_(l[1])); });
      return o;
    },
    setConfig: function (novo) {
      var atual = store.getConfig();
      Object.keys(novo).forEach(function (k) { atual[k] = novo[k]; });
      reescrever(ABA.CONFIG, Object.keys(atual).map(function (k) { return [k, JSON.stringify(atual[k])]; }));
    },

    // ---- pessoas
    listPessoas: function () {
      return tabela(ABA.PESSOAS).linhas.filter(function (l) { return String(l[0]).trim() !== ''; }).map(function (l) {
        var perfil = String(l[6] || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return {
          mat: FeedbackCore.normMat(l[0]), nome: lerCelula_(l[1]), cc: lerCelula_(l[2]),
          liderMat: FeedbackCore.normMat(l[4]), liderNome: lerCelula_(l[5]),
          perfil: FeedbackCore.PERFIS.indexOf(perfil) >= 0 ? perfil : 'COLABORADOR',
          ativo: !ehNao_(l[7]), cpfHash: String(l[8] || '').trim(), atualizadoEm: String(l[9] || '')
        };
      });
    },
    salvarPessoa: function (p) {
      var t = tabela(ABA.PESSOAS);
      var linha = [p.mat, p.nome, p.cc, FeedbackCore.utdDoCC(p.cc), p.liderMat, p.liderNome, p.perfil, simNao_(p.ativo), p.cpfHash, p.atualizadoEm];
      var idx = -1;
      t.linhas.forEach(function (l, i) { if (FeedbackCore.normMat(l[0]) === p.mat) idx = i; });
      if (idx >= 0) {
        escrever(t.sh, idx + 2, [linha]);
        delete memo[ABA.PESSOAS];
      } else {
        acrescentar(ABA.PESSOAS, [linha]);
      }
    },
    substituirPessoas: function (lista) {
      var ordenada = lista.slice().sort(function (a, b) { return a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0; });
      reescrever(ABA.PESSOAS, ordenada.map(function (p) {
        return [p.mat, p.nome, p.cc, FeedbackCore.utdDoCC(p.cc), p.liderMat, p.liderNome, p.perfil, simNao_(p.ativo), p.cpfHash, p.atualizadoEm];
      }));
    },

    // ---- critérios
    listCriterios: function () {
      return tabela(ABA.CRITERIOS).linhas.filter(function (l) { return String(l[0]).trim() !== ''; }).map(function (l) {
        return { id: String(l[0]).trim(), form: String(l[1]).trim(), ordem: numero_(l[2]) || 0, texto: lerCelula_(l[3]), ativo: !ehNao_(l[4]) };
      });
    },
    salvarCriterios: function (lista) {
      reescrever(ABA.CRITERIOS, lista.map(function (c) { return [c.id, c.form, String(c.ordem), c.texto, simNao_(c.ativo !== false)]; }));
    },

    // ---- participação (identificada: só registra QUE a pessoa respondeu)
    listParticipacao: function (ciclo) {
      return tabela(ABA.PART).linhas.filter(function (l) { return l[0] && (!ciclo || l[0] === ciclo); }).map(function (l) {
        return { ciclo: l[0], form: l[1], avaliador: FeedbackCore.normMat(l[2]), avaliadorNome: l[3], avaliado: FeedbackCore.normMat(l[4]), avaliadoNome: l[5], data: l[6] };
      });
    },
    addParticipacao: function (r) {
      acrescentar(ABA.PART, [[r.ciclo, r.form, r.avaliador, r.avaliadorNome, r.avaliado, r.avaliadoNome, r.data]]);
    },

    // ---- Liderado x Líder (anônimo, gravado em lotes embaralhados)
    listUp: function (ciclo) {
      var t = tabela(ABA.UP);
      var mapa = colunasNota_(t.cab);
      var daPlanilha = t.linhas.filter(function (l) { return l[0] && (!ciclo || l[1] === ciclo); }).map(function (l) {
        var notas = {};
        Object.keys(mapa).forEach(function (id) { var v = numero_(l[mapa[id]]); if (v) notas[id] = v; });
        return {
          id: l[0], ciclo: l[1], avaliado: FeedbackCore.normMat(l[2]), avaliadoNome: lerCelula_(l[3]), media: numero_(l[4]),
          fortes: lista_(l[5]), fracos: lista_(l[6]), consideracoes: lerCelula_(l[7]), notas: notas
        };
      });
      var naFila = lerFila().map(function (x) { return x.rec; }).filter(function (r) { return !ciclo || r.ciclo === ciclo; });
      return daPlanilha.concat(naFila);
    },
    addUp: function (r) {
      // Cada resposta espera numa fila até juntar um lote. O lote vai para a planilha
      // embaralhado, sem data e sem quem respondeu: nem o histórico de versões da
      // planilha permite ligar uma resposta a uma pessoa.
      props.setProperty(PREFIXO_FILA + r.id, JSON.stringify(r));
      if (lerFila().length >= TAMANHO_LOTE) store.descarregar();
    },
    descarregar: function () {
      return store.comTrava(function () {
        var fila = lerFila();
        if (!fila.length) return 0;
        var ids = {};
        fila.forEach(function (x) { Object.keys(x.rec.notas || {}).forEach(function (k) { ids[k] = true; }); });
        var t = garantirColunasNota(ABA.UP, Object.keys(ids), store.listCriterios().length ? store.listCriterios() : FeedbackCore.CRITERIOS_PADRAO);
        var linhas = embaralhar_(fila).map(function (x) { return linhaUp(x.rec, t); });
        acrescentar(ABA.UP, linhas);
        fila.forEach(function (x) { props.deleteProperty(x.chave); });
        return linhas.length;
      });
    },

    // ---- Líder x Liderado (identificado)
    listDown: function (ciclo) {
      var t = tabela(ABA.DOWN);
      var mapa = colunasNota_(t.cab);
      return t.linhas.filter(function (l) { return l[0] && (!ciclo || l[1] === ciclo); }).map(function (l) {
        var notas = {};
        Object.keys(mapa).forEach(function (id) { var v = numero_(l[mapa[id]]); if (v) notas[id] = v; });
        return {
          id: l[0], ciclo: l[1], avaliador: FeedbackCore.normMat(l[2]), avaliadorNome: lerCelula_(l[3]),
          avaliado: FeedbackCore.normMat(l[4]), avaliadoNome: lerCelula_(l[5]), dataFeedback: l[6], dataReavaliacao: l[7],
          media: numero_(l[8]), obs: json_(l[9], {}), consideracoes: lerCelula_(l[10]), enviadoEm: l[11], atualizadoEm: l[12], notas: notas
        };
      });
    },
    saveDown: function (r) {
      var t = garantirColunasNota(ABA.DOWN, Object.keys(r.notas || {}), store.listCriterios().length ? store.listCriterios() : FeedbackCore.CRITERIOS_PADRAO);
      var mapa = colunasNota_(t.cab);
      var linha = [];
      for (var i = 0; i < t.cab.length; i++) linha.push('');
      var fixos = [r.id, r.ciclo, r.avaliador, r.avaliadorNome, r.avaliado, r.avaliadoNome, r.dataFeedback, r.dataReavaliacao || '',
        r.media == null ? '' : String(r.media), Object.keys(r.obs || {}).length ? JSON.stringify(r.obs) : '', r.consideracoes || '', r.enviadoEm, r.atualizadoEm];
      fixos.forEach(function (v, j) { linha[j] = v; });
      Object.keys(r.notas || {}).forEach(function (k) { if (mapa[k] !== undefined) linha[mapa[k]] = String(r.notas[k]); });
      var idx = -1;
      t.linhas.forEach(function (l, j) { if (l[0] === r.id) idx = j; });
      if (idx >= 0) {
        escrever(t.sh, idx + 2, [linha]);
        delete memo[ABA.DOWN];
      } else {
        acrescentar(ABA.DOWN, [linha]);
      }
    },

    // ---- registro de uso (sem conteúdo das avaliações)
    log: function (mat, evento, detalhe) {
      try {
        acrescentar(ABA.LOG, [[store.agora(), mat || '', evento || '', String(detalhe || '').slice(0, 300)]]);
      } catch (e) { console.error(e); }
    },

    // ---- sessão e tentativas
    cacheGet: function (k) { return cache.get(k); },
    cachePut: function (k, v, seg) { cache.put(k, String(v), Math.min(21600, Math.max(1, Math.floor(seg)))); },
    cacheDel: function (k) { cache.remove(k); },

    // ---- utilidades
    hash: sha256_,
    segredo: segredo_,
    uuid: function () { return Utilities.getUuid(); },
    hoje: function () { return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd'); },
    agora: function () { return Utilities.formatDate(new Date(), FUSO, "yyyy-MM-dd'T'HH:mm:ss"); },
    comTrava: function (fn) {
      if (trava > 0) return fn();
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) {
        var e = new Error('O sistema está ocupado agora. Tente de novo em alguns segundos.');
        e.code = 'OCUPADO';
        throw e;
      }
      trava++;
      try {
        return fn();
      } finally {
        trava--;
        SpreadsheetApp.flush();
        lock.releaseLock();
      }
    },
    erro: function (e) { console.error(e && e.stack ? e.stack : e); }
  };
  return store;
}

// ------------------------------------------------------------------ menu da planilha

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Feedback')
    .addItem('1. Preparar planilha', 'prepararPlanilha')
    .addItem('2. Cadastrar acesso da coordenação ou do RH', 'cadastrarGestor')
    .addItem('3. Importar base colada na aba "Importar"', 'importarDaAba')
    .addSeparator()
    .addItem('Gravar respostas que estão na fila', 'gravarFila')
    .addItem('Ver link do aplicativo', 'mostrarLink')
    .addToUi();
}

function ui_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}
function avisar_(msg) {
  var ui = ui_();
  if (ui) ui.alert(msg); else console.log(msg);
}

/** A planilha não cresce sozinha quando o script escreve além do fim: aumenta antes. */
function garantirTamanho_(sh, linhas, colunas) {
  var mr = sh.getMaxRows(), mc = sh.getMaxColumns();
  if (linhas > mr) sh.insertRowsAfter(mr, Math.max(linhas - mr, 200));
  if (colunas > mc) sh.insertColumnsAfter(mc, colunas - mc);
}

function garantirAba_(ss, nome, cab) {
  var sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  garantirTamanho_(sh, 1, cab ? cab.length : 1);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
  if (cab && cab.length) {
    var atual = sh.getRange(1, 1, 1, cab.length).getDisplayValues()[0];
    if (atual.join('') === '') {
      sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#15365c').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function prepararPlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  if (!ss) {
    var id = props.getProperty(PROP_PLANILHA);
    ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Feedback Semestral · Banco de dados');
  }
  props.setProperty(PROP_PLANILHA, ss.getId());
  segredo_();
  Object.keys(CABECALHOS).forEach(function (nome) { garantirAba_(ss, nome, CABECALHOS[nome]); });
  var imp = garantirAba_(ss, ABA.IMPORTAR, null);
  imp.getRange('A1').setNote('Cole aqui a base de colaboradores com o cabeçalho na linha 1 (Matricula, Descrição C.C, Liderança, Nome completo, C.P.F.) e use o menu Feedback → 3. Importar. Depois da importação esta aba é apagada.');
  ['Página1', 'Sheet1', 'Planilha1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  var store = PlanilhaStore();
  if (!store.listCriterios().length) store.salvarCriterios(FeedbackCore.CRITERIOS_PADRAO);
  if (!Object.keys(store.getConfig()).length) store.setConfig(FeedbackCore.CONFIG_PADRAO);
  avisar_('Planilha preparada.\n\nPróximo passo: menu Feedback → 2. Cadastrar acesso da coordenação ou do RH.');
  return ss.getId();
}

function perguntar_(ui, titulo, texto) {
  var r = ui.prompt(titulo, texto, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  return r.getResponseText().trim();
}

function cadastrarGestor() {
  var ui = ui_();
  if (!ui) throw new Error('Rode este item pelo menu Feedback dentro da planilha.');
  var mat = perguntar_(ui, 'Matrícula', 'Matrícula da pessoa (vai ser o login):');
  if (!mat) return;
  mat = FeedbackCore.normMat(mat);
  var store = PlanilhaStore();
  var atual = null;
  store.listPessoas().forEach(function (p) { if (p.mat === mat) atual = p; });
  var nome = perguntar_(ui, 'Nome completo', atual
    ? 'Nome atual: ' + atual.nome + '\nDeixe em branco para manter.'
    : 'Nome completo, igual ao que aparece na coluna Liderança da base (ex.: FULANO DE TAL SANTOS):');
  if (nome === null) return;
  nome = (nome || (atual ? atual.nome : '')).toUpperCase().replace(/\s+/g, ' ').trim();
  if (!nome) { ui.alert('Informe o nome.'); return; }
  var cpf = perguntar_(ui, 'CPF', (atual && atual.cpfHash ? 'Deixe em branco para manter o CPF atual.\n' : '') + 'CPF (é a senha de acesso; fica guardado criptografado):');
  if (cpf === null) return;
  var digitos = FeedbackCore.digitos(cpf);
  if (digitos && digitos.length !== 11) { ui.alert('O CPF precisa ter 11 dígitos.'); return; }
  if (!digitos && !(atual && atual.cpfHash)) { ui.alert('Informe o CPF.'); return; }
  var perfil = perguntar_(ui, 'Perfil', 'Digite COORDENACAO ou RH:');
  if (perfil === null) return;
  perfil = perfil.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');
  if (['COORDENACAO', 'RH'].indexOf(perfil) < 0) { ui.alert('Perfil inválido. Use COORDENACAO ou RH.'); return; }
  store.salvarPessoa({
    mat: mat, nome: nome, cc: atual ? atual.cc : '', liderMat: atual ? atual.liderMat : '', liderNome: atual ? atual.liderNome : '',
    perfil: perfil, ativo: true, cpfHash: digitos ? FeedbackCore.hashCpf(store, mat, digitos) : atual.cpfHash, atualizadoEm: store.agora()
  });
  store.log('planilha', 'gestor_cadastrado', mat + ' ' + perfil);
  ui.alert('Acesso de ' + (perfil === 'RH' ? 'RH' : 'coordenação') + ' cadastrado para ' + nome + ' (matrícula ' + mat + ').');
}

function importarDaAba() {
  var ui = ui_();
  var ss = planilha_();
  var sh = ss.getSheetByName(ABA.IMPORTAR);
  if (!sh || sh.getLastRow() < 2) {
    avisar_('Cole a base na aba "Importar" (cabeçalho na linha 1) e rode este item de novo.');
    return;
  }
  var matriz = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  var desativar = false;
  if (ui) {
    var resp = ui.alert('Importar base',
      'Desativar quem NÃO estiver nesta base?\n\nSim: desativa colaboradores ausentes (desligados).\nNão: só adiciona e atualiza.',
      ui.ButtonSet.YES_NO_CANCEL);
    if (resp === ui.Button.CANCEL || resp === ui.Button.CLOSE) return;
    desativar = resp === ui.Button.YES;
  }
  var r = FeedbackCore.importar(PlanilhaStore(), matriz, { desativarAusentes: desativar }, 'planilha');
  sh.clearContents();
  var pend = r.lideres.filter(function (l) { return !l.encontrado; });
  avisar_('Base importada.\n\n' +
    r.novos + ' novos · ' + r.atualizados + ' atualizados · ' + r.desativados + ' desativados\n' +
    (r.semCpf.length ? 'Sem CPF (não conseguem entrar): ' + r.semCpf.join(', ') + '\n' : '') +
    (pend.length ? '\nLíderes ainda sem cadastro: ' + pend.map(function (l) { return l.nome + ' (' + l.liderados + ')'; }).join(', ') +
      '\nCadastre-os no menu 2 com o mesmo nome da coluna Liderança.' : '') +
    '\n\nA aba "Importar" foi apagada para não deixar CPFs abertos.');
}

function gravarFila() {
  var n = PlanilhaStore().descarregar();
  avisar_(n ? n + ' resposta(s) gravada(s) na aba ' + ABA.UP + '.' : 'Não há respostas na fila.');
}

function mostrarLink() {
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  avisar_(url ? 'Link do aplicativo:\n\n' + url : 'O aplicativo ainda não foi implantado.\nNo editor do Apps Script: Implantar → Nova implantação → App da Web.');
}
