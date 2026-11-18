/**
 * Feedback Semestral · núcleo de regras
 * Compartilhado entre o servidor (Google Apps Script) e a demonstração (navegador).
 * Nada aqui acessa planilha ou navegador diretamente: tudo passa pelo objeto "store".
 */
var FeedbackCore = (function () {
  'use strict';

  var FORM_UP = 'LIDERADO_LIDER';   // o liderado avalia o líder (anônimo)
  var FORM_DOWN = 'LIDER_LIDERADO'; // o líder avalia o liderado (identificado)
  var PERFIS = ['COLABORADOR', 'RH', 'COORDENACAO'];
  var ADMIN = { RH: true, COORDENACAO: true };
  var SESSAO_SEG = 4 * 60 * 60;
  var MAX_TENTATIVAS = 5;
  var BLOQUEIO_SEG = 15 * 60;
  var LIMITE_TEXTO = 1500;
  var LIMITE_ITEM = 160;
  var LIMITE_OBS = 500;

  var CRITERIOS_PADRAO = [
    { id: 'LL01', form: FORM_UP, ordem: 1, texto: 'Comunicação e clareza nas orientações', ativo: true },
    { id: 'LL02', form: FORM_UP, ordem: 2, texto: 'Respeito e tratamento justo', ativo: true },
    { id: 'LL03', form: FORM_UP, ordem: 3, texto: 'Escuta e abertura ao diálogo', ativo: true },
    { id: 'LL04', form: FORM_UP, ordem: 4, texto: 'Organização e distribuição das atividades', ativo: true },
    { id: 'LL05', form: FORM_UP, ordem: 5, texto: 'Apoio ao desenvolvimento da equipe', ativo: true },
    { id: 'LL06', form: FORM_UP, ordem: 6, texto: 'Reconhecimento e valorização', ativo: true },
    { id: 'LL07', form: FORM_UP, ordem: 7, texto: 'Resolução de conflitos', ativo: true },
    { id: 'LL08', form: FORM_UP, ordem: 8, texto: 'Compromisso com a segurança', ativo: true },
    { id: 'LL09', form: FORM_UP, ordem: 9, texto: 'Disponibilidade e apoio à equipe', ativo: true },
    { id: 'LL10', form: FORM_UP, ordem: 10, texto: 'Contribui para o meu desenvolvimento profissional', ativo: true },
    { id: 'LL11', form: FORM_UP, ordem: 11, texto: 'Tenho liberdade para conversar com meu líder quando algo não está bem', ativo: true },
    { id: 'LL12', form: FORM_UP, ordem: 12, texto: 'Orienta e acompanha a equipe nos procedimentos de segurança', ativo: true },
    { id: 'LL13', form: FORM_UP, ordem: 13, texto: 'É transparente, fala a verdade e transmite confiança para a equipe', ativo: true },
    { id: 'LD01', form: FORM_DOWN, ordem: 1, texto: 'Comprometimento', ativo: true },
    { id: 'LD02', form: FORM_DOWN, ordem: 2, texto: 'Pontualidade e assiduidade', ativo: true },
    { id: 'LD03', form: FORM_DOWN, ordem: 3, texto: 'Responsabilidade', ativo: true },
    { id: 'LD04', form: FORM_DOWN, ordem: 4, texto: 'Qualidade do trabalho', ativo: true },
    { id: 'LD05', form: FORM_DOWN, ordem: 5, texto: 'Produtividade e organização', ativo: true },
    { id: 'LD06', form: FORM_DOWN, ordem: 6, texto: 'Trabalho em equipe', ativo: true },
    { id: 'LD07', form: FORM_DOWN, ordem: 7, texto: 'Comunicação', ativo: true },
    { id: 'LD08', form: FORM_DOWN, ordem: 8, texto: 'Proatividade e aprendizagem', ativo: true },
    { id: 'LD09', form: FORM_DOWN, ordem: 9, texto: 'Cumprimento de normas e procedimentos', ativo: true },
    { id: 'LD10', form: FORM_DOWN, ordem: 10, texto: 'Segurança no trabalho', ativo: true }
  ];

  var CONFIG_PADRAO = {
    ciclo: '2026-2',
    faseLideradoLider: 'ABERTA',
    faseLiderLiderado: 'FECHADA',
    ciclosLiberados: [],
    minimoRespostas: 3,
    escala: ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'],
    organizacao: 'Sirtec · Operação Centro-BA'
  };

  // ---------------------------------------------------------------- utilidades

  function erro(code, message) { var e = new Error(message); e.code = code; return e; }
  function str(v) { return v == null ? '' : String(v); }
  function semAcento(s) { return str(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function norm(s) { return semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim(); }
  function chave(s) { return norm(s).replace(/[^A-Z0-9 ]+/g, '').replace(/\s+/g, ' ').trim(); }
  function digitos(s) { return str(s).replace(/\D+/g, ''); }

  function normMat(s) {
    var t = str(s).trim().replace(/\s+/g, '');
    if (/^\d+(\.0+)?$/.test(t)) t = t.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
    return t.toUpperCase();
  }

  var PARTICULAS = { DE: 1, DA: 1, DO: 1, DAS: 1, DOS: 1, E: 1, DI: 1, DU: 1 };
  function titulo(nome) {
    var partes = str(nome).replace(/\s+/g, ' ').trim().toLowerCase().split(' ');
    return partes.map(function (w, i) {
      if (!w) return w;
      if (i > 0 && PARTICULAS[semAcento(w).toUpperCase()]) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  function primeiroNome(nome) { return titulo(nome).split(' ')[0] || ''; }
  function nomeMascarado(nome) {
    var p = titulo(nome).split(' ');
    if (p.length <= 2) return p.join(' ');
    var meio = p.slice(1, -1).map(function (w) {
      return (PARTICULAS[semAcento(w).toUpperCase()] || /^\d+$/.test(w)) ? w : w.charAt(0) + '.';
    });
    return [p[0]].concat(meio, [p[p.length - 1]]).join(' ');
  }

  function utdDoCC(cc) {
    var c = ' ' + chave(cc) + ' ';
    if (c.indexOf(' IRE ') >= 0) return 'Irecê';
    if (c.indexOf(' ITA ') >= 0) return 'Itaberaba';
    if (c.indexOf(' SEA ') >= 0) return 'Seabra';
    if (c.indexOf(' SER ') >= 0) return 'Serrinha';
    return '';
  }

  function cpfValido(cpf) {
    var d = digitos(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var s = 0;
      for (var i = 0; i < t; i++) s += Number(d.charAt(i)) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(d.charAt(t))) return false;
    }
    return true;
  }

  function hashCpf(store, mat, cpf) {
    return store.hash(store.segredo() + '|' + normMat(mat) + '|' + digitos(cpf));
  }

  function texto(s, max) {
    return str(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  }
  function textoLinha(s, max) { return texto(s, max * 2).replace(/\s+/g, ' ').trim().slice(0, max); }
  function dataValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(str(s)); }
  function arred(x, casas) { var f = Math.pow(10, casas); return Math.round(x * f) / f; }
  function media(notas) {
    var ks = Object.keys(notas || {});
    if (!ks.length) return null;
    var s = 0;
    ks.forEach(function (k) { s += Number(notas[k]); });
    return arred(s / ks.length, 2);
  }
  function embaralhar(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function porNome(a, b) { return a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0; }
  function rotuloCiclo(c) {
    var m = /^(\d{4})-([12])$/.exec(str(c));
    return m ? m[2] + 'º semestre de ' + m[1] : str(c);
  }

  // ---------------------------------------------------------------- dados

  function config(store) {
    var c = store.getConfig() || {};
    var out = {};
    Object.keys(CONFIG_PADRAO).forEach(function (k) {
      var v = c[k];
      out[k] = (v === undefined || v === null || v === '') ? CONFIG_PADRAO[k] : v;
    });
    if (!Array.isArray(out.ciclosLiberados)) out.ciclosLiberados = [];
    if (!Array.isArray(out.escala) || out.escala.length !== 5) out.escala = CONFIG_PADRAO.escala;
    out.minimoRespostas = Math.max(1, Math.floor(Number(out.minimoRespostas)) || 3);
    out.ciclo = str(out.ciclo);
    return out;
  }

  function todosCriterios(store) {
    var l = store.listCriterios() || [];
    if (!l.length) l = CRITERIOS_PADRAO;
    return l.map(function (c) {
      return { id: str(c.id), form: c.form === FORM_DOWN ? FORM_DOWN : FORM_UP, ordem: Number(c.ordem) || 0, texto: str(c.texto), ativo: c.ativo !== false };
    }).sort(function (a, b) { return a.form < b.form ? -1 : a.form > b.form ? 1 : (a.ordem - b.ordem); });
  }
  function criteriosAtivos(store, form) {
    return todosCriterios(store).filter(function (c) { return c.form === form && c.ativo; })
      .map(function (c) { return { id: c.id, texto: c.texto }; });
  }

  function indice(pessoas) {
    var porMat = {}, porNomeIdx = {};
    pessoas.forEach(function (p) {
      porMat[p.mat] = p;
      var n = chave(p.nome);
      if (!porNomeIdx[n] || (p.ativo && !porNomeIdx[n].ativo)) porNomeIdx[n] = p;
    });
    return { porMat: porMat, porNome: porNomeIdx };
  }

  function liderDe(p, idx) {
    if (!p) return null;
    var l = null;
    if (p.liderMat && idx.porMat[p.liderMat]) l = idx.porMat[p.liderMat];
    else if (p.liderNome) l = idx.porNome[chave(p.liderNome)] || null;
    if (!l || l.mat === p.mat || !l.ativo) return null;
    return l;
  }

  function carregar(store) {
    var pessoas = store.listPessoas();
    var idx = indice(pessoas);
    var liderMap = {}, equipes = {};
    pessoas.forEach(function (p) {
      if (!p.ativo) return;
      var l = liderDe(p, idx);
      if (l) {
        liderMap[p.mat] = l.mat;
        (equipes[l.mat] = equipes[l.mat] || []).push(p);
      }
    });
    return { pessoas: pessoas, idx: idx, liderMap: liderMap, equipes: equipes };
  }

  function vPessoa(p) {
    return p ? { mat: p.mat, nome: titulo(p.nome), cc: str(p.cc).trim(), utd: utdDoCC(p.cc), perfil: p.perfil } : null;
  }

  function ciclosDisponiveis(store, cfg) {
    var s = {};
    s[cfg.ciclo] = true;
    store.listParticipacao().forEach(function (x) { if (x.ciclo) s[x.ciclo] = true; });
    return Object.keys(s).sort().reverse().map(function (c) { return { id: c, rotulo: rotuloCiclo(c) }; });
  }

  // ---------------------------------------------------------------- sessão

  function novaSessao(store, pessoa) {
    var token = (store.uuid() + store.uuid()).replace(/-/g, '');
    store.cachePut('s:' + token, pessoa.mat, SESSAO_SEG);
    return token;
  }

  function sessao(store, token) {
    if (!token || typeof token !== 'string' || token.length < 20) throw erro('SESSAO', 'Sua sessão expirou. Entre novamente.');
    var mat = store.cacheGet('s:' + token);
    if (!mat) throw erro('SESSAO', 'Sua sessão expirou. Entre novamente.');
    var base = carregar(store);
    var eu = base.idx.porMat[mat];
    if (!eu || !eu.ativo) {
      store.cacheDel('s:' + token);
      throw erro('SESSAO', 'Seu acesso foi desativado. Procure o RH.');
    }
    store.cachePut('s:' + token, mat, SESSAO_SEG);
    base.eu = eu;
    base.token = token;
    base.isAdmin = !!ADMIN[eu.perfil];
    base.cfg = config(store);
    return base;
  }

  // ---------------------------------------------------------------- acesso

  function aLookup(store, d) {
    var mat = normMat(d.mat);
    if (!mat) throw erro('VALIDACAO', 'Digite sua matrícula.');
    var p = null;
    store.listPessoas().forEach(function (x) { if (x.mat === mat) p = x; });
    if (!p) throw erro('NAO_ENCONTRADO', 'Matrícula não encontrada. Confira o número ou procure o RH.');
    if (!p.ativo) throw erro('INATIVO', 'Esta matrícula está desativada. Procure o RH.');
    return { mat: p.mat, nome: nomeMascarado(p.nome), utd: utdDoCC(p.cc) };
  }

  function aLogin(store, d) {
    var mat = normMat(d.mat);
    var cpf = digitos(d.cpf);
    if (!mat) throw erro('VALIDACAO', 'Digite sua matrícula.');
    var chaveFalha = 'f:' + mat;
    var falhas = Number(store.cacheGet(chaveFalha) || 0);
    if (falhas >= MAX_TENTATIVAS) throw erro('BLOQUEADO', 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');
    var p = null;
    store.listPessoas().forEach(function (x) { if (x.mat === mat) p = x; });
    if (!p) throw erro('NAO_ENCONTRADO', 'Matrícula não encontrada. Confira o número ou procure o RH.');
    if (!p.ativo) throw erro('INATIVO', 'Esta matrícula está desativada. Procure o RH.');
    if (!p.cpfHash) throw erro('SEM_SENHA', 'Seu cadastro está sem CPF. Procure o RH.');
    if (cpf.length !== 11 || hashCpf(store, mat, cpf) !== p.cpfHash) {
      falhas++;
      store.cachePut(chaveFalha, String(falhas), BLOQUEIO_SEG);
      store.log(mat, 'login_falhou', '');
      var resta = MAX_TENTATIVAS - falhas;
      if (resta <= 0) throw erro('BLOQUEADO', 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');
      throw erro('CPF_INVALIDO', 'O CPF não confere com esta matrícula. ' + (resta === 1 ? 'Resta 1 tentativa.' : 'Restam ' + resta + ' tentativas.'));
    }
    store.cacheDel(chaveFalha);
    var token = novaSessao(store, p);
    store.log(mat, 'login', '');
    var ctx = sessao(store, token);
    return { token: token, home: aHome(store, ctx) };
  }

  function aSair(store, ctx) {
    store.cacheDel('s:' + ctx.token);
    return { ok: true };
  }

  // ---------------------------------------------------------------- início

  function aHome(store, ctx) {
    var cfg = ctx.cfg, eu = ctx.eu;
    var lider = ctx.idx.porMat[ctx.liderMap[eu.mat]] || null;
    var resp = {};
    store.listParticipacao(cfg.ciclo).forEach(function (x) { if (x.form === FORM_UP) resp[x.avaliador] = x; });
    var equipe = ctx.equipes[eu.mat] || [];
    var avaliados = 0;
    if (equipe.length) {
      var feitos = {};
      store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === eu.mat) feitos[r.avaliado] = true; });
      equipe.forEach(function (p) { if (feitos[p.mat]) avaliados++; });
    }
    return {
      eu: {
        mat: eu.mat, nome: titulo(eu.nome), primeiroNome: primeiroNome(eu.nome), cc: str(eu.cc).trim(),
        utd: utdDoCC(eu.cc), perfil: eu.perfil, admin: ctx.isAdmin, lider: equipe.length > 0
      },
      ciclo: cfg.ciclo,
      cicloRotulo: rotuloCiclo(cfg.ciclo),
      organizacao: cfg.organizacao,
      fases: { up: cfg.faseLideradoLider, down: cfg.faseLiderLiderado },
      meuLider: lider ? { nome: titulo(lider.nome), coordenacao: lider.perfil === 'COORDENACAO' } : null,
      avaliouLider: !!resp[eu.mat],
      avaliouLiderEm: resp[eu.mat] ? resp[eu.mat].data : null,
      equipe: equipe.length ? {
        total: equipe.length,
        responderam: equipe.filter(function (p) { return !!resp[p.mat]; }).length,
        avaliados: avaliados
      } : null
    };
  }

  // ---------------------------------------------------------------- Liderado x Líder (anônimo)

  function lerNotas(obj, crits) {
    obj = obj || {};
    var out = {};
    crits.forEach(function (c) {
      var v = Number(obj[c.id]);
      if (!(v >= 1 && v <= 5 && Math.floor(v) === v)) throw erro('INCOMPLETO', 'Dê uma nota de 1 a 5 para todos os itens.');
      out[c.id] = v;
    });
    return out;
  }
  function lerLista(arr, n, msg) {
    var a = (Array.isArray(arr) ? arr : []).map(function (x) { return textoLinha(x, LIMITE_ITEM); }).filter(Boolean);
    if (a.length < n) throw erro('INCOMPLETO', msg);
    return a.slice(0, n);
  }

  function aFormLider(store, ctx) {
    var cfg = ctx.cfg;
    var lider = ctx.idx.porMat[ctx.liderMap[ctx.eu.mat]];
    if (!lider) throw erro('SEM_LIDER', 'Não encontramos o seu líder no cadastro. Procure o RH.');
    var enviada = store.listParticipacao(cfg.ciclo).some(function (x) { return x.form === FORM_UP && x.avaliador === ctx.eu.mat; });
    var extras = lider.perfil === 'COORDENACAO';
    return {
      lider: { nome: titulo(lider.nome), coordenacao: extras },
      fase: cfg.faseLideradoLider,
      enviada: enviada,
      criterios: criteriosAtivos(store, FORM_UP),
      extras: extras,
      escala: cfg.escala,
      minimo: cfg.minimoRespostas,
      ciclo: cfg.ciclo,
      cicloRotulo: rotuloCiclo(cfg.ciclo)
    };
  }

  function aEnviarLider(store, ctx, d) {
    var cfg = ctx.cfg;
    if (cfg.faseLideradoLider !== 'ABERTA') throw erro('FASE_FECHADA', 'A avaliação do líder está encerrada neste ciclo.');
    var lider = ctx.idx.porMat[ctx.liderMap[ctx.eu.mat]];
    if (!lider) throw erro('SEM_LIDER', 'Não encontramos o seu líder no cadastro. Procure o RH.');
    var crits = criteriosAtivos(store, FORM_UP);
    var notas = lerNotas(d.notas, crits);
    var extras = lider.perfil === 'COORDENACAO';
    var fortes = [], fracos = [];
    if (extras) {
      fortes = lerLista(d.fortes, 3, 'Escreva os 3 pontos fortes.');
      fracos = lerLista(d.fracos, 3, 'Escreva os 3 pontos fracos (o que pode melhorar).');
    }
    var consideracoes = texto(d.consideracoes, LIMITE_TEXTO);
    return store.comTrava(function () {
      var ja = store.listParticipacao(cfg.ciclo).some(function (x) { return x.form === FORM_UP && x.avaliador === ctx.eu.mat; });
      if (ja) throw erro('JA_ENVIADA', 'Você já enviou a avaliação do seu líder neste ciclo. Obrigado!');
      // A resposta é gravada SEM quem respondeu, sem data e em posição embaralhada.
      store.addUp({
        id: store.uuid(), ciclo: cfg.ciclo, avaliado: lider.mat, avaliadoNome: lider.nome,
        notas: notas, media: media(notas), fortes: fortes, fracos: fracos, consideracoes: consideracoes
      });
      // A participação registra só QUE a pessoa respondeu (para o controle de pendências).
      store.addParticipacao({
        ciclo: cfg.ciclo, form: FORM_UP, avaliador: ctx.eu.mat, avaliadorNome: ctx.eu.nome,
        avaliado: lider.mat, avaliadoNome: lider.nome, data: store.hoje()
      });
      store.log(ctx.eu.mat, 'avaliou_lider', '');
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- equipe do líder

  function aEquipe(store, ctx) {
    var equipe = ctx.equipes[ctx.eu.mat] || [];
    if (!equipe.length) throw erro('PERMISSAO', 'Você não tem liderados cadastrados.');
    var cfg = ctx.cfg;
    var resp = {};
    store.listParticipacao(cfg.ciclo).forEach(function (x) { if (x.form === FORM_UP) resp[x.avaliador] = true; });
    var down = {};
    store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === ctx.eu.mat) down[r.avaliado] = r; });
    return {
      ciclo: cfg.ciclo,
      cicloRotulo: rotuloCiclo(cfg.ciclo),
      fases: { up: cfg.faseLideradoLider, down: cfg.faseLiderLiderado },
      pessoas: equipe.map(function (p) {
        var r = down[p.mat];
        return {
          mat: p.mat, nome: titulo(p.nome), cc: str(p.cc).trim(), utd: utdDoCC(p.cc),
          respondeu: !!resp[p.mat], avaliado: !!r, media: r ? r.media : null
        };
      }).sort(porNome)
    };
  }

  // ---------------------------------------------------------------- Líder x Liderado (identificado)

  function lideradoDe(ctx, mat) {
    mat = normMat(mat);
    var p = null;
    (ctx.equipes[ctx.eu.mat] || []).forEach(function (x) { if (x.mat === mat) p = x; });
    if (!p) throw erro('PERMISSAO', 'Este colaborador não faz parte da sua equipe.');
    return p;
  }

  function vDown(r) {
    return r ? {
      id: r.id, avaliado: r.avaliado, dataFeedback: r.dataFeedback, dataReavaliacao: r.dataReavaliacao,
      notas: r.notas || {}, obs: r.obs || {}, consideracoes: r.consideracoes || '', media: r.media,
      atualizadoEm: r.atualizadoEm
    } : null;
  }

  function aFormLiderado(store, ctx, d) {
    var p = lideradoDe(ctx, d.mat);
    var cfg = ctx.cfg;
    var atual = null;
    store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === ctx.eu.mat && r.avaliado === p.mat) atual = r; });
    return {
      liderado: vPessoa(p),
      fase: cfg.faseLiderLiderado,
      criterios: criteriosAtivos(store, FORM_DOWN),
      escala: cfg.escala,
      atual: vDown(atual),
      hoje: store.hoje(),
      ciclo: cfg.ciclo,
      cicloRotulo: rotuloCiclo(cfg.ciclo)
    };
  }

  function aSalvarLiderado(store, ctx, d) {
    var cfg = ctx.cfg;
    if (cfg.faseLiderLiderado !== 'ABERTA') throw erro('FASE_FECHADA', 'A avaliação dos liderados não está aberta no momento.');
    var p = lideradoDe(ctx, d.mat);
    var crits = criteriosAtivos(store, FORM_DOWN);
    var notas = lerNotas(d.notas, crits);
    var obs = {};
    crits.forEach(function (c) { var t = texto((d.obs || {})[c.id], LIMITE_OBS); if (t) obs[c.id] = t; });
    var dataFeedback = str(d.dataFeedback);
    if (!dataValida(dataFeedback)) throw erro('VALIDACAO', 'Informe a data do feedback.');
    var dataReavaliacao = str(d.dataReavaliacao);
    if (dataReavaliacao && !dataValida(dataReavaliacao)) throw erro('VALIDACAO', 'A data da reavaliação é inválida.');
    if (dataReavaliacao && dataReavaliacao < dataFeedback) throw erro('VALIDACAO', 'A reavaliação precisa ser depois da data do feedback.');
    var consideracoes = texto(d.consideracoes, LIMITE_TEXTO);
    return store.comTrava(function () {
      var existente = null;
      store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === ctx.eu.mat && r.avaliado === p.mat) existente = r; });
      var agora = store.agora();
      var rec = {
        id: existente ? existente.id : store.uuid(), ciclo: cfg.ciclo,
        avaliador: ctx.eu.mat, avaliadorNome: ctx.eu.nome, avaliado: p.mat, avaliadoNome: p.nome,
        dataFeedback: dataFeedback, dataReavaliacao: dataReavaliacao,
        notas: notas, media: media(notas), obs: obs, consideracoes: consideracoes,
        enviadoEm: existente ? existente.enviadoEm : agora, atualizadoEm: agora
      };
      store.saveDown(rec);
      store.log(ctx.eu.mat, existente ? 'editou_liderado' : 'avaliou_liderado', p.mat);
      return { ok: true, media: rec.media };
    });
  }

  // ---------------------------------------------------------------- resultados (agrupados)

  function visibilidade(cfg, ciclo, isAdmin) {
    if (ciclo === cfg.ciclo && cfg.faseLideradoLider === 'ABERTA') {
      return { ok: false, motivo: 'Os resultados aparecem depois que a coordenação encerrar a avaliação do líder (Liderado x Líder). Assim ninguém consegue deduzir quem respondeu o quê.' };
    }
    if (!isAdmin && cfg.ciclosLiberados.indexOf(ciclo) < 0) {
      return { ok: false, motivo: 'A coordenação ainda não liberou os resultados deste ciclo para os líderes.' };
    }
    return { ok: true };
  }

  function consolidar(store, cfg, ciclo, liderMat) {
    var rs = store.listUp(ciclo).filter(function (r) { return r.avaliado === liderMat; });
    var out = { n: rs.length, minimo: cfg.minimoRespostas };
    if (rs.length < cfg.minimoRespostas) { out.insuficiente = true; return out; }
    var textos = {};
    todosCriterios(store).forEach(function (c) { if (c.form === FORM_UP) textos[c.id] = c; });
    var presentes = {};
    rs.forEach(function (r) { Object.keys(r.notas || {}).forEach(function (k) { presentes[k] = true; }); });
    var lista = Object.keys(presentes).map(function (id) {
      return { id: id, texto: textos[id] ? textos[id].texto : id, ordem: textos[id] ? textos[id].ordem : 999 };
    }).sort(function (a, b) { return (a.ordem - b.ordem) || (a.id < b.id ? -1 : 1); });
    var soma = 0, cont = 0;
    out.itens = lista.map(function (c) {
      var dist = [0, 0, 0, 0, 0], s = 0, k = 0;
      rs.forEach(function (r) {
        var v = Number((r.notas || {})[c.id]);
        if (v >= 1 && v <= 5) { dist[v - 1]++; s += v; k++; }
      });
      soma += s; cont += k;
      return { id: c.id, texto: c.texto, media: k ? arred(s / k, 1) : null, n: k, dist: dist };
    });
    out.media = cont ? arred(soma / cont, 1) : null;
    out.comentarios = embaralhar(rs.map(function (r) { return r.consideracoes; }).filter(Boolean));
    var fortes = [], fracos = [];
    rs.forEach(function (r) { fortes = fortes.concat(r.fortes || []); fracos = fracos.concat(r.fracos || []); });
    out.fortes = embaralhar(fortes.filter(Boolean));
    out.fracos = embaralhar(fracos.filter(Boolean));
    return out;
  }

  function aMeusResultados(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var ciclos = ciclosDisponiveis(store, cfg);
    var base = { ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclos, coordenacao: ctx.eu.perfil === 'COORDENACAO', lider: vPessoa(ctx.eu) };
    var vis = visibilidade(cfg, ciclo, ctx.isAdmin);
    if (!vis.ok) { base.oculto = true; base.motivo = vis.motivo; return base; }
    var r = consolidar(store, cfg, ciclo, ctx.eu.mat);
    Object.keys(base).forEach(function (k) { r[k] = base[k]; });
    return r;
  }

  // ---------------------------------------------------------------- painel de gestão

  function mapasCiclo(store, ciclo) {
    var resp = {};
    store.listParticipacao(ciclo).forEach(function (x) { if (x.form === FORM_UP) resp[x.avaliador] = x; });
    var down = {};
    store.listDown(ciclo).forEach(function (r) { down[r.avaliador + '>' + r.avaliado] = r; });
    return { resp: resp, down: down };
  }

  function aPainel(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var m = mapasCiclo(store, ciclo);
    var ups = store.listUp(ciclo);
    var vis = visibilidade(cfg, ciclo, true);
    var ativos = ctx.pessoas.filter(function (p) { return p.ativo; });
    var comLider = ativos.filter(function (p) { return !!ctx.liderMap[p.mat]; });
    var lideres = Object.keys(ctx.equipes).map(function (mat) { return ctx.idx.porMat[mat]; }).filter(Boolean);
    var linhas = lideres.map(function (l) {
      var eq = ctx.equipes[l.mat];
      var nUp = ups.filter(function (r) { return r.avaliado === l.mat; });
      var mediaUp = null;
      if (vis.ok && nUp.length >= cfg.minimoRespostas) {
        var s = 0, k = 0;
        nUp.forEach(function (r) { Object.keys(r.notas || {}).forEach(function (c) { s += Number(r.notas[c]); k++; }); });
        mediaUp = k ? arred(s / k, 1) : null;
      }
      var downs = eq.map(function (p) { return m.down[l.mat + '>' + p.mat]; }).filter(Boolean);
      var mediaDown = downs.length ? arred(downs.reduce(function (a, r) { return a + Number(r.media || 0); }, 0) / downs.length, 1) : null;
      return {
        mat: l.mat, nome: titulo(l.nome), perfil: l.perfil, utd: utdDoCC(l.cc), equipe: eq.length,
        responderam: eq.filter(function (p) { return !!m.resp[p.mat]; }).length,
        avaliados: downs.length, mediaUp: mediaUp, nRespostas: vis.ok ? nUp.length : null, mediaDown: mediaDown
      };
    }).sort(function (a, b) { return b.equipe - a.equipe || (a.nome < b.nome ? -1 : 1); });
    return {
      ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg),
      atual: ciclo === cfg.ciclo,
      fases: { up: cfg.faseLideradoLider, down: cfg.faseLiderLiderado },
      totais: {
        ativos: ativos.length,
        comLider: comLider.length,
        responderam: comLider.filter(function (p) { return !!m.resp[p.mat]; }).length,
        avaliados: comLider.filter(function (p) { return !!m.down[ctx.liderMap[p.mat] + '>' + p.mat]; }).length,
        semCpf: ativos.filter(function (p) { return !p.cpfHash; }).length
      },
      lideres: linhas,
      resultadosVisiveis: vis.ok,
      motivo: vis.motivo || '',
      liberado: cfg.ciclosLiberados.indexOf(ciclo) >= 0,
      minimo: cfg.minimoRespostas
    };
  }

  function aParticipacao(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var m = mapasCiclo(store, ciclo);
    var pessoas = ctx.pessoas.filter(function (p) { return p.ativo; }).map(function (p) {
      var l = ctx.idx.porMat[ctx.liderMap[p.mat]];
      var r = l ? m.down[l.mat + '>' + p.mat] : null;
      return {
        mat: p.mat, nome: titulo(p.nome), cc: str(p.cc).trim(), utd: utdDoCC(p.cc), perfil: p.perfil,
        lider: l ? titulo(l.nome) : '', liderMat: l ? l.mat : '',
        respondeu: !!m.resp[p.mat], respondeuEm: m.resp[p.mat] ? m.resp[p.mat].data : null,
        avaliado: !!r, mediaDown: r ? r.media : null
      };
    }).sort(porNome);
    return { ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg), pessoas: pessoas };
  }

  function aResultadoLider(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var l = ctx.idx.porMat[normMat(d.lider)];
    if (!l) throw erro('VALIDACAO', 'Líder não encontrado.');
    var base = { ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), lider: vPessoa(l), coordenacao: l.perfil === 'COORDENACAO' };
    var vis = visibilidade(cfg, ciclo, true);
    if (!vis.ok) { base.oculto = true; base.motivo = vis.motivo; return base; }
    var r = consolidar(store, cfg, ciclo, l.mat);
    Object.keys(base).forEach(function (k) { r[k] = base[k]; });
    return r;
  }

  function criteriosDoForm(store, form, registros) {
    var todos = todosCriterios(store).filter(function (c) { return c.form === form; });
    var usados = {};
    registros.forEach(function (r) { Object.keys(r.notas || {}).forEach(function (k) { usados[k] = true; }); });
    return todos.filter(function (c) { return c.ativo || usados[c.id]; }).map(function (c) { return { id: c.id, texto: c.texto }; });
  }

  function aLiderLiderado(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var downs = store.listDown(ciclo);
    var idx = ctx.idx;
    return {
      ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg),
      criterios: criteriosDoForm(store, FORM_DOWN, downs),
      registros: downs.map(function (r) {
        var av = idx.porMat[r.avaliado];
        return {
          id: r.id, avaliador: r.avaliador, avaliadorNome: titulo(r.avaliadorNome || (idx.porMat[r.avaliador] || {}).nome),
          avaliado: r.avaliado, avaliadoNome: titulo(r.avaliadoNome || (av || {}).nome), utd: utdDoCC(av ? av.cc : ''),
          dataFeedback: r.dataFeedback, dataReavaliacao: r.dataReavaliacao, media: r.media,
          notas: r.notas || {}, obs: r.obs || {}, consideracoes: r.consideracoes || '', atualizadoEm: r.atualizadoEm
        };
      }).sort(function (a, b) { return a.avaliadoNome < b.avaliadoNome ? -1 : 1; })
    };
  }

  // ---------------------------------------------------------------- cadastro

  function aPessoas(store, ctx) {
    var idx = ctx.idx;
    return {
      perfis: PERFIS,
      pessoas: ctx.pessoas.map(function (p) {
        var l = liderDe(p, idx);
        var refNome = p.liderNome && !l ? titulo(p.liderNome) : '';
        return {
          mat: p.mat, nome: titulo(p.nome), cc: str(p.cc).trim(), utd: utdDoCC(p.cc), perfil: p.perfil,
          ativo: !!p.ativo, temCpf: !!p.cpfHash, liderMat: l ? l.mat : '', liderNome: l ? titulo(l.nome) : '',
          liderPendente: refNome, equipe: (ctx.equipes[p.mat] || []).length
        };
      }).sort(porNome)
    };
  }

  function aSalvarPessoa(store, ctx, d) {
    var mat = normMat(d.mat);
    if (!mat) throw erro('VALIDACAO', 'Informe a matrícula.');
    var nome = textoLinha(d.nome, 120).toUpperCase();
    if (!nome) throw erro('VALIDACAO', 'Informe o nome completo.');
    var perfil = PERFIS.indexOf(d.perfil) >= 0 ? d.perfil : 'COLABORADOR';
    var ativo = d.ativo !== false;
    var cc = textoLinha(d.cc, 60).toUpperCase();
    var liderMat = normMat(d.liderMat);
    var novo = !!d.novo;
    return store.comTrava(function () {
      var pessoas = store.listPessoas();
      var idx = indice(pessoas);
      var atual = idx.porMat[mat];
      if (novo && atual) throw erro('VALIDACAO', 'Já existe uma pessoa com a matrícula ' + mat + '.');
      if (!novo && !atual) throw erro('VALIDACAO', 'Matrícula não encontrada.');
      var lider = null;
      if (liderMat) {
        if (liderMat === mat) throw erro('VALIDACAO', 'A pessoa não pode ser líder de si mesma.');
        lider = idx.porMat[liderMat];
        if (!lider) throw erro('VALIDACAO', 'Líder não encontrado.');
        var vistos = {}, cur = lider;
        while (cur && !vistos[cur.mat]) {
          if (cur.mat === mat) throw erro('VALIDACAO', 'Essa mudança criaria um ciclo na liderança.');
          vistos[cur.mat] = true;
          cur = liderDe(cur, idx);
        }
      }
      if (atual && atual.perfil === 'COORDENACAO' && atual.ativo && (perfil !== 'COORDENACAO' || !ativo)) {
        var outros = pessoas.filter(function (p) { return p.ativo && p.perfil === 'COORDENACAO' && p.mat !== mat; });
        if (!outros.length) throw erro('VALIDACAO', 'Mantenha pelo menos uma pessoa ativa com perfil Coordenação.');
      }
      if (mat === ctx.eu.mat && (!ativo || !ADMIN[perfil])) throw erro('VALIDACAO', 'Você não pode remover o seu próprio acesso de gestão.');
      var cpfHash = atual ? atual.cpfHash : '';
      if (d.cpf) {
        var dg = digitos(d.cpf);
        if (dg.length !== 11) throw erro('VALIDACAO', 'O CPF precisa ter 11 dígitos.');
        cpfHash = hashCpf(store, mat, dg);
      }
      if (!cpfHash) throw erro('VALIDACAO', 'Informe o CPF: ele é a senha de acesso.');
      store.salvarPessoa({
        mat: mat, nome: nome, cc: cc, liderMat: lider ? lider.mat : '', liderNome: lider ? lider.nome : '',
        perfil: perfil, ativo: ativo, cpfHash: cpfHash, atualizadoEm: store.agora()
      });
      store.log(ctx.eu.mat, novo ? 'pessoa_criada' : 'pessoa_editada', mat);
      return { ok: true };
    });
  }

  // Importação da base (ex.: sra_feedback.xlsx). "matriz" = cabeçalho + linhas.
  var CAMPOS_IMPORTACAO = [
    { campo: 'cpf', re: /\bCPF\b/ },
    { campo: 'mat', re: /\bMATRICULA\b|\bMAT\b|\bCHAPA\b/ },
    { campo: 'lider', re: /LIDERANCA|\bLIDER\b|SUPERVISOR|GESTOR/ },
    { campo: 'perfil', re: /\bPERFIL\b/ },
    { campo: 'cc', re: /\bC ?C\b|CENTRO DE CUSTO|DESCRICAO/ },
    { campo: 'nome', re: /\bNOME\b/ }
  ];

  function mapearCabecalho(cab) {
    var mapa = {};
    (cab || []).forEach(function (h, i) {
      var k = chave(h);
      if (!k) return;
      for (var j = 0; j < CAMPOS_IMPORTACAO.length; j++) {
        var c = CAMPOS_IMPORTACAO[j];
        if (mapa[c.campo] === undefined && c.re.test(k)) { mapa[c.campo] = i; return; }
      }
    });
    return mapa;
  }

  function importar(store, matriz, opts, autorMat) {
    opts = opts || {};
    if (!Array.isArray(matriz) || matriz.length < 2) throw erro('VALIDACAO', 'A planilha está vazia.');
    var cab = matriz[0];
    var mapa = mapearCabecalho(cab);
    var faltando = ['mat', 'nome', 'lider', 'cpf'].filter(function (c) { return mapa[c] === undefined; });
    if (faltando.indexOf('mat') >= 0 || faltando.indexOf('nome') >= 0) {
      throw erro('VALIDACAO', 'Não encontrei as colunas obrigatórias (Matrícula e Nome). Confira o cabeçalho da primeira linha.');
    }
    var col = function (linha, campo) { return mapa[campo] === undefined ? '' : linha[mapa[campo]]; };
    var executar = function () {
      var pessoas = store.listPessoas();
      var porMat = {};
      pessoas.forEach(function (p) { porMat[p.mat] = JSON.parse(JSON.stringify(p)); });
      var vistos = {}, novos = 0, atualizados = 0, semCpf = [], cpfInvalido = [], duplicados = [], ignoradas = 0;
      var agora = store.agora();
      matriz.slice(1).forEach(function (linha) {
        if (!Array.isArray(linha) || !linha.some(function (v) { return str(v).trim() !== ''; })) return;
        var mat = normMat(col(linha, 'mat'));
        var nome = textoLinha(col(linha, 'nome'), 120).toUpperCase();
        if (!mat || !nome) { ignoradas++; return; }
        if (vistos[mat]) { duplicados.push(mat); return; }
        vistos[mat] = true;
        var atual = porMat[mat];
        var cpf = digitos(col(linha, 'cpf'));
        if (cpf.length >= 8 && cpf.length < 11) cpf = ('00000000000' + cpf).slice(-11); // CPF salvo como número perde zeros à esquerda
        var cpfHash = atual ? atual.cpfHash : '';
        if (cpf.length === 11) {
          if (!opts.simular) cpfHash = hashCpf(store, mat, cpf);
          else cpfHash = 'ok';
          if (!cpfValido(cpf)) cpfInvalido.push(mat);
        } else if (!cpfHash) {
          semCpf.push(mat);
        }
        var perfilLinha = norm(col(linha, 'perfil'));
        var perfil = PERFIS.indexOf(perfilLinha) >= 0 ? perfilLinha : (atual ? atual.perfil : 'COLABORADOR');
        porMat[mat] = {
          mat: mat, nome: nome, cc: textoLinha(col(linha, 'cc'), 60).toUpperCase(),
          liderMat: '', liderNome: textoLinha(col(linha, 'lider'), 120).toUpperCase(),
          perfil: perfil, ativo: true, cpfHash: cpfHash, atualizadoEm: agora
        };
        if (atual) atualizados++; else novos++;
      });
      var desativados = 0;
      if (opts.desativarAusentes) {
        Object.keys(porMat).forEach(function (m) {
          var p = porMat[m];
          if (!vistos[m] && p.ativo && p.perfil === 'COLABORADOR') { p.ativo = false; p.atualizadoEm = agora; desativados++; }
        });
      }
      var todos = Object.keys(porMat).map(function (k) { return porMat[k]; });
      var idx = indice(todos);
      var lideres = {};
      todos.forEach(function (p) {
        if (!vistos[p.mat] || !p.liderNome) return;
        var l = idx.porNome[chave(p.liderNome)];
        var k = chave(p.liderNome);
        if (!lideres[k]) lideres[k] = { nome: titulo(p.liderNome), liderados: 0, encontrado: !!(l && l.mat !== p.mat) };
        lideres[k].liderados++;
        if (l && l.mat !== p.mat) p.liderMat = l.mat;
      });
      if (!opts.simular) {
        store.substituirPessoas(todos);
        store.log(autorMat || 'sistema', 'importou_base', novos + ' novos, ' + atualizados + ' atualizados, ' + desativados + ' desativados');
      }
      return {
        simulacao: !!opts.simular, linhas: matriz.length - 1, novos: novos, atualizados: atualizados,
        desativados: desativados, ignoradas: ignoradas, semCpf: semCpf, cpfInvalido: cpfInvalido, duplicados: duplicados,
        lideres: Object.keys(lideres).map(function (k) { return lideres[k]; }).sort(function (a, b) { return b.liderados - a.liderados; }),
        colunas: Object.keys(mapa).reduce(function (o, k) { o[k] = str(cab[mapa[k]]); return o; }, {}),
        faltando: faltando
      };
    };
    return opts.simular ? executar() : store.comTrava(executar);
  }

  function aImportar(store, ctx, d) {
    return importar(store, d.matriz, { simular: !!d.simular, desativarAusentes: !!d.desativarAusentes }, ctx.eu.mat);
  }

  // ---------------------------------------------------------------- configurações

  function aConfig(store, ctx) {
    var cfg = ctx.cfg;
    return {
      config: cfg, cicloRotulo: rotuloCiclo(cfg.ciclo), ciclos: ciclosDisponiveis(store, cfg),
      criterios: todosCriterios(store), liberado: cfg.ciclosLiberados.indexOf(cfg.ciclo) >= 0
    };
  }

  function aSalvarConfig(store, ctx, d) {
    var cfg = ctx.cfg;
    var novo = {};
    if (d.faseLideradoLider) novo.faseLideradoLider = d.faseLideradoLider === 'ABERTA' ? 'ABERTA' : 'FECHADA';
    if (d.faseLiderLiderado) novo.faseLiderLiderado = d.faseLiderLiderado === 'ABERTA' ? 'ABERTA' : 'FECHADA';
    if (d.minimoRespostas !== undefined) {
      var m = Math.floor(Number(d.minimoRespostas));
      if (!(m >= 1 && m <= 20)) throw erro('VALIDACAO', 'O mínimo de respostas deve ficar entre 1 e 20.');
      novo.minimoRespostas = m;
    }
    if (d.liberar !== undefined) {
      var lib = cfg.ciclosLiberados.slice();
      var c = str(d.cicloLiberar) || cfg.ciclo;
      var i = lib.indexOf(c);
      if (d.liberar && i < 0) lib.push(c);
      if (!d.liberar && i >= 0) lib.splice(i, 1);
      novo.ciclosLiberados = lib;
    }
    if (d.novoCiclo) {
      var nc = str(d.novoCiclo).trim();
      if (!/^\d{4}-[12]$/.test(nc)) throw erro('VALIDACAO', 'Use o formato ANO-SEMESTRE, por exemplo 2027-1.');
      if (nc === cfg.ciclo) throw erro('VALIDACAO', 'Esse já é o ciclo atual.');
      novo.ciclo = nc;
      novo.faseLideradoLider = 'FECHADA';
      novo.faseLiderLiderado = 'FECHADA';
    }
    if (d.organizacao) novo.organizacao = textoLinha(d.organizacao, 80);
    if (!Object.keys(novo).length) throw erro('VALIDACAO', 'Nada para salvar.');
    store.setConfig(novo);
    if ((novo.faseLideradoLider === 'FECHADA' || novo.ciclo) && store.descarregar) store.descarregar();
    store.log(ctx.eu.mat, 'configuracao', JSON.stringify(novo));
    ctx.cfg = config(store);
    return aConfig(store, ctx);
  }

  function aSalvarCriterio(store, ctx, d) {
    var lista = todosCriterios(store);
    var form = d.form === FORM_DOWN ? FORM_DOWN : FORM_UP;
    if (d.id) {
      var c = null;
      lista.forEach(function (x) { if (x.id === d.id) c = x; });
      if (!c) throw erro('VALIDACAO', 'Item não encontrado.');
      if (d.texto !== undefined) {
        var t = textoLinha(d.texto, 200);
        if (!t) throw erro('VALIDACAO', 'Escreva o texto do item.');
        c.texto = t;
      }
      if (d.ativo !== undefined) c.ativo = !!d.ativo;
      if (d.mover) {
        var irmaos = lista.filter(function (x) { return x.form === c.form; }).sort(function (a, b) { return a.ordem - b.ordem; });
        var pos = irmaos.indexOf(c), alvo = irmaos[pos + (d.mover > 0 ? 1 : -1)];
        if (alvo) { var o = c.ordem; c.ordem = alvo.ordem; alvo.ordem = o; }
      }
    } else {
      var txt = textoLinha(d.texto, 200);
      if (!txt) throw erro('VALIDACAO', 'Escreva o texto do item.');
      var prefixo = form === FORM_UP ? 'LL' : 'LD';
      var maxId = 0, maxOrdem = 0;
      lista.forEach(function (x) {
        if (x.id.indexOf(prefixo) === 0) maxId = Math.max(maxId, Number(x.id.slice(2)) || 0);
        if (x.form === form) maxOrdem = Math.max(maxOrdem, x.ordem);
      });
      var nid = prefixo + (maxId + 1 < 10 ? '0' : '') + (maxId + 1);
      lista.push({ id: nid, form: form, ordem: maxOrdem + 1, texto: txt, ativo: true });
    }
    store.salvarCriterios(lista);
    store.log(ctx.eu.mat, 'criterios', d.id || 'novo');
    return { ok: true, criterios: todosCriterios(store) };
  }

  // ---------------------------------------------------------------- exportação

  function aExportar(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var tipo = str(d.tipo);
    var idx = ctx.idx;
    var nomeDe = function (mat) { return idx.porMat[mat] ? titulo(idx.porMat[mat].nome) : ''; };
    if (tipo === 'participacao') {
      var p = aParticipacao(store, ctx, { ciclo: ciclo }).pessoas;
      return {
        arquivo: 'participacao_' + ciclo,
        cabecalho: ['Ciclo', 'Matrícula', 'Nome', 'C.C', 'UTD', 'Líder', 'Avaliou o líder', 'Data', 'Avaliado pelo líder', 'Média recebida'],
        linhas: p.map(function (x) {
          return [ciclo, x.mat, x.nome, x.cc, x.utd, x.lider, x.respondeu ? 'Sim' : 'Não', x.respondeuEm || '', x.avaliado ? 'Sim' : 'Não', x.mediaDown == null ? '' : x.mediaDown];
        })
      };
    }
    if (tipo === 'liderado_lider') {
      var vis = visibilidade(cfg, ciclo, true);
      if (!vis.ok) throw erro('OCULTO', vis.motivo);
      var ups = store.listUp(ciclo);
      var contagem = {};
      ups.forEach(function (r) { contagem[r.avaliado] = (contagem[r.avaliado] || 0) + 1; });
      ups = embaralhar(ups.filter(function (r) { return contagem[r.avaliado] >= cfg.minimoRespostas; }));
      var cu = criteriosDoForm(store, FORM_UP, ups);
      return {
        arquivo: 'liderado_x_lider_' + ciclo,
        cabecalho: ['Ciclo', 'Líder avaliado', 'Matrícula do líder', 'Média'].concat(cu.map(function (c) { return c.texto; }), ['Pontos fortes', 'Pontos fracos', 'Considerações finais']),
        linhas: ups.map(function (r) {
          return [ciclo, titulo(r.avaliadoNome || nomeDe(r.avaliado)), r.avaliado, r.media].concat(
            cu.map(function (c) { return (r.notas || {})[c.id] || ''; }),
            [(r.fortes || []).join(' | '), (r.fracos || []).join(' | '), r.consideracoes || '']);
        }),
        observacao: 'Respostas anônimas. Líderes com menos de ' + cfg.minimoRespostas + ' respostas não aparecem.'
      };
    }
    if (tipo === 'lider_liderado') {
      var downs = store.listDown(ciclo);
      var cd = criteriosDoForm(store, FORM_DOWN, downs);
      return {
        arquivo: 'lider_x_liderado_' + ciclo,
        cabecalho: ['Ciclo', 'Líder', 'Matrícula do líder', 'Liderado', 'Matrícula do liderado', 'Data do feedback', 'Data da reavaliação', 'Média']
          .concat(cd.map(function (c) { return c.texto; }), ['Observações', 'Considerações finais', 'Atualizado em']),
        linhas: downs.map(function (r) {
          var obs = Object.keys(r.obs || {}).map(function (k) {
            var c = null; cd.forEach(function (x) { if (x.id === k) c = x; });
            return (c ? c.texto : k) + ': ' + r.obs[k];
          }).join(' | ');
          return [ciclo, titulo(r.avaliadorNome || nomeDe(r.avaliador)), r.avaliador, titulo(r.avaliadoNome || nomeDe(r.avaliado)), r.avaliado,
            r.dataFeedback || '', r.dataReavaliacao || '', r.media].concat(cd.map(function (c) { return (r.notas || {})[c.id] || ''; }), [obs, r.consideracoes || '', r.atualizadoEm || '']);
        })
      };
    }
    if (tipo === 'pessoas') {
      var ps = aPessoas(store, ctx).pessoas;
      return {
        arquivo: 'cadastro_' + store.hoje(),
        cabecalho: ['Matrícula', 'Nome', 'C.C', 'UTD', 'Líder', 'Perfil', 'Ativo', 'CPF cadastrado', 'Liderados'],
        linhas: ps.map(function (x) {
          return [x.mat, x.nome, x.cc, x.utd, x.liderNome || x.liderPendente, x.perfil, x.ativo ? 'Sim' : 'Não', x.temCpf ? 'Sim' : 'Não', x.equipe];
        })
      };
    }
    throw erro('VALIDACAO', 'Tipo de exportação desconhecido.');
  }

  // ---------------------------------------------------------------- roteador

  var ACOES = {
    home: { fn: aHome },
    sair: { fn: aSair },
    formLider: { fn: aFormLider },
    enviarLider: { fn: aEnviarLider },
    equipe: { fn: aEquipe },
    formLiderado: { fn: aFormLiderado },
    salvarLiderado: { fn: aSalvarLiderado },
    meusResultados: { fn: aMeusResultados },
    painel: { fn: aPainel, admin: true },
    participacao: { fn: aParticipacao, admin: true },
    resultadoLider: { fn: aResultadoLider, admin: true },
    liderLiderado: { fn: aLiderLiderado, admin: true },
    pessoas: { fn: aPessoas, admin: true },
    salvarPessoa: { fn: aSalvarPessoa, admin: true },
    importar: { fn: aImportar, admin: true },
    config: { fn: aConfig, admin: true },
    salvarConfig: { fn: aSalvarConfig, admin: true },
    salvarCriterio: { fn: aSalvarCriterio, admin: true },
    exportar: { fn: aExportar, admin: true }
  };

  function handle(store, acao, dados, token) {
    try {
      dados = dados || {};
      if (acao === 'lookup') return { ok: true, data: aLookup(store, dados) };
      if (acao === 'login') return { ok: true, data: aLogin(store, dados) };
      var a = ACOES[acao];
      if (!a) throw erro('ACAO', 'Ação desconhecida.');
      var ctx = sessao(store, token);
      if (a.admin && !ctx.isAdmin) throw erro('PERMISSAO', 'Acesso restrito à coordenação e ao RH.');
      return { ok: true, data: a.fn(store, ctx, dados) };
    } catch (e) {
      if (e && e.code) return { ok: false, code: e.code, message: e.message };
      if (store.erro) store.erro(e);
      return { ok: false, code: 'ERRO', message: 'Erro inesperado. Tente novamente em instantes.' };
    }
  }

  return {
    handle: handle,
    importar: importar,
    hashCpf: hashCpf,
    cpfValido: cpfValido,
    normMat: normMat,
    digitos: digitos,
    titulo: titulo,
    nomeMascarado: nomeMascarado,
    utdDoCC: utdDoCC,
    mapearCabecalho: mapearCabecalho,
    config: config,
    rotuloCiclo: rotuloCiclo,
    CRITERIOS_PADRAO: CRITERIOS_PADRAO,
    CONFIG_PADRAO: CONFIG_PADRAO,
    FORM_UP: FORM_UP,
    FORM_DOWN: FORM_DOWN,
    PERFIS: PERFIS
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FeedbackCore;


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
