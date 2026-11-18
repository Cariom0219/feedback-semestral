// Gerado por build.js a partir de src/core.js, src/store-memory.js e src/server.supabase.js. Não edite aqui.
var postgres = null;
/**
 * Feedback Semestral · núcleo de regras
 * Usado pelo servidor (Supabase Edge Function) e pela demonstração (navegador).
 * Nada aqui acessa banco ou navegador diretamente: tudo passa pelo objeto "store".
 */
var FeedbackCore = (function () {
  'use strict';

  var FORM_UP = 'LIDERADO_LIDER';   // a equipe avalia o líder (itens de liderança)
  var FORM_DOWN = 'LIDER_LIDERADO'; // o líder avalia cada liderado
  var PERFIS = ['COLABORADOR', 'RH', 'COORDENACAO'];
  var ADMIN = { RH: true, COORDENACAO: true };
  var SESSAO_SEG = 4 * 60 * 60;
  var MAX_TENTATIVAS = 5;
  var BLOQUEIO_SEG = 15 * 60;
  var LIMITE_TEXTO = 1500;
  var LIMITE_ITEM = 160;
  var LIMITE_PORQUE = 500;
  var TIPOS_AGENDA = { FEEDBACK: 'Feedback', ACOMPANHAMENTO: 'Acompanhamento' };
  var STATUS_AGENDA = { AGENDADO: 'Agendado', REALIZADO: 'Realizado', CANCELADO: 'Cancelado' };

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
    limiteMensal: 3.5,   // média abaixo disso → acompanhamento mensal
    notaCritica: 2,      // nota igual ou abaixo disso em qualquer item → mensal e precisa do "por quê"
    escala: ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'],
    organizacao: 'Sirtec · Operação Centro-BA'
  };

  // ---------------------------------------------------------------- utilidades

  function erro(code, message, campo) { var e = new Error(message); e.code = code; if (campo) e.campo = campo; return e; }
  function str(v) { return v == null ? '' : String(v); }
  function semAcento(s) { return str(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
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
  function fmt1(x) { return x === null || x === undefined ? '–' : arred(Number(x), 1).toFixed(1).replace('.', ','); }
  function media(notas) {
    var ks = Object.keys(notas || {});
    if (!ks.length) return null;
    var s = 0;
    ks.forEach(function (k) { s += Number(notas[k]); });
    return arred(s / ks.length, 2);
  }
  function porNome(a, b) { return a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0; }
  function porData(a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; }
  function rotuloCiclo(c) {
    var m = /^(\d{4})-([12])$/.exec(str(c));
    return m ? m[2] + 'º semestre de ' + m[1] : str(c);
  }

  // datas no formato AAAA-MM-DD, sem fuso
  function partes(iso) { return str(iso).split('-').map(Number); }
  function isoDe(d) { return d.toISOString().slice(0, 10); }
  function somarDias(iso, n) { var p = partes(iso); return isoDe(new Date(Date.UTC(p[0], p[1] - 1, p[2] + n))); }
  function diaSemana(iso) { var p = partes(iso); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function diaUtil(iso) { var d = iso; while (diaSemana(d) === 0 || diaSemana(d) === 6) d = somarDias(d, 1); return d; }
  function somarMeses(iso, m) {
    var p = partes(iso);
    var alvo = new Date(Date.UTC(p[0], p[1] - 1 + m, 1));
    var ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    return isoDe(new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(p[2], ultimo))));
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
    var lm = Number(out.limiteMensal);
    out.limiteMensal = lm >= 1 && lm <= 5 ? arred(lm, 1) : CONFIG_PADRAO.limiteMensal;
    var nc = Math.floor(Number(out.notaCritica));
    out.notaCritica = nc >= 0 && nc <= 4 ? nc : CONFIG_PADRAO.notaCritica;
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
  /** id → {texto, ordem}; itens de liderança (LL) antes dos itens do liderado (LD). */
  function infoCriterios(store) {
    var m = {};
    todosCriterios(store).forEach(function (c) { m[c.id] = { texto: c.texto, ordem: (c.form === FORM_UP ? 0 : 100) + c.ordem }; });
    return m;
  }
  function itensOrdenados(notas, info, porque) {
    return Object.keys(notas || {}).map(function (id) {
      return { id: id, texto: info[id] ? info[id].texto : id, nota: Number(notas[id]), porque: (porque || {})[id] || '', ordem: info[id] ? info[id].ordem : 999 };
    }).sort(function (a, b) { return a.ordem - b.ordem; });
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

  function ehLider(ctx, mat) { return (ctx.equipes[mat] || []).length > 0; }

  /** Como o líder avalia este liderado: itens de liderança + 3 pontos fortes e 3 fracos para quem lidera
   *  uma equipe e para todos que respondem direto à coordenação; os demais usam os itens do liderado. */
  function formaAvaliacao(ctx, p) {
    if (ehLider(ctx, p.mat)) return { lideranca: true, motivo: 'EQUIPE' };
    if (ctx.eu.perfil === 'COORDENACAO') return { lideranca: true, motivo: 'COORDENACAO' };
    return { lideranca: false, motivo: '' };
  }

  function vPessoa(p) {
    return p ? { mat: p.mat, nome: titulo(p.nome), cc: str(p.cc).trim(), utd: utdDoCC(p.cc), perfil: p.perfil } : null;
  }

  function ciclosDisponiveis(store, cfg) {
    var s = {};
    s[cfg.ciclo] = true;
    store.listParticipacao().forEach(function (x) { if (x.ciclo) s[x.ciclo] = true; });
    store.listDown().forEach(function (x) { if (x.ciclo) s[x.ciclo] = true; });
    return Object.keys(s).sort().reverse().map(function (c) { return { id: c, rotulo: rotuloCiclo(c) }; });
  }

  // ---------------------------------------------------------------- médias e frequência

  function mediaGeral(registros) {
    var s = 0, k = 0;
    registros.forEach(function (r) { Object.keys(r.notas || {}).forEach(function (c) { var v = Number(r.notas[c]); if (v >= 1 && v <= 5) { s += v; k++; } }); });
    return k ? arred(s / k, 2) : null;
  }
  function mediaPorCriterio(registros) {
    var soma = {}, cont = {};
    registros.forEach(function (r) {
      Object.keys(r.notas || {}).forEach(function (c) {
        var v = Number(r.notas[c]);
        if (v >= 1 && v <= 5) { soma[c] = (soma[c] || 0) + v; cont[c] = (cont[c] || 0) + 1; }
      });
    });
    var out = {};
    Object.keys(soma).forEach(function (c) { out[c] = { media: arred(soma[c] / cont[c], 2), n: cont[c] }; });
    return out;
  }
  function listaItens(porCrit, info) {
    return Object.keys(porCrit).map(function (id) {
      return { id: id, texto: info[id] ? info[id].texto : id, media: porCrit[id].media, n: porCrit[id].n, ordem: info[id] ? info[id].ordem : 999 };
    }).sort(function (a, b) { return a.ordem - b.ordem; });
  }

  /** Mensal: média abaixo do limite, alguma nota crítica ou (para líderes) média da equipe abaixo do limite. */
  function frequenciaDe(cfg, rec, info, mediaEquipe) {
    if (!rec || rec.media === null || rec.media === undefined) return null;
    var motivos = [];
    if (Number(rec.media) < cfg.limiteMensal) motivos.push('média ' + fmt1(rec.media) + ', abaixo de ' + fmt1(cfg.limiteMensal));
    if (cfg.notaCritica > 0) {
      itensOrdenados(rec.notas, info).forEach(function (it) {
        if (it.nota <= cfg.notaCritica) motivos.push('nota ' + it.nota + ' em ' + it.texto);
      });
    }
    if (mediaEquipe !== null && mediaEquipe !== undefined && mediaEquipe < cfg.limiteMensal) {
      motivos.push('média dada pela equipe ' + fmt1(mediaEquipe));
    }
    return { tipo: motivos.length ? 'MENSAL' : 'SEMESTRAL', motivos: motivos };
  }

  /** Média que a equipe deu ao líder no ciclo (para quem pode ver). */
  function mediaDaEquipe(store, cfg, ciclo, liderMat, isAdmin, ups) {
    if (!visibilidade(cfg, ciclo, isAdmin).ok) return null;
    var rs = (ups || store.listUp(ciclo)).filter(function (r) { return r.avaliado === liderMat; });
    return rs.length ? mediaGeral(rs) : null;
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

  // Primeiro acesso da coordenação: com o código gerado no banco, cria o acesso de coordenação.
  // Só funciona enquanto não existe ninguém ativo com perfil Coordenação.
  function aConfigurarCoordenacao(store, d) {
    var esperado = store.codigoConfiguracao ? str(store.codigoConfiguracao()) : '';
    if (!esperado) throw erro('INDISPONIVEL', 'Este servidor não usa código de configuração.');
    var chaveT = 'cfg:tentativas';
    var tentativas = Number(store.cacheGet(chaveT) || 0);
    if (tentativas >= 10) throw erro('BLOQUEADO', 'Muitas tentativas com código errado. Aguarde 1 hora.');
    if (store.listPessoas().some(function (p) { return p.ativo && p.perfil === 'COORDENACAO'; })) {
      throw erro('JA_CONFIGURADO', 'A coordenação já foi cadastrada. Entre pela tela normal, com matrícula e CPF.');
    }
    if (str(d.codigo).trim().toUpperCase() !== esperado.trim().toUpperCase()) {
      store.cachePut(chaveT, String(tentativas + 1), 3600);
      throw erro('CODIGO', 'Código de configuração incorreto.');
    }
    var mat = normMat(d.mat);
    var nome = textoLinha(d.nome, 120).toUpperCase();
    var cpf = digitos(d.cpf);
    if (!mat) throw erro('VALIDACAO', 'Informe a sua matrícula.');
    if (!nome) throw erro('VALIDACAO', 'Informe o seu nome completo, igual ao da coluna Liderança da base.');
    if (cpf.length !== 11) throw erro('VALIDACAO', 'O CPF precisa ter 11 dígitos.');
    return store.comTrava(function () {
      var atual = null;
      store.listPessoas().forEach(function (p) { if (p.mat === mat) atual = p; });
      store.salvarPessoa({
        mat: mat, nome: nome, cc: atual ? atual.cc : '', liderMat: atual ? atual.liderMat : '', liderNome: atual ? atual.liderNome : '',
        perfil: 'COORDENACAO', ativo: true, cpfHash: hashCpf(store, mat, cpf), atualizadoEm: store.agora()
      });
      store.cacheDel(chaveT);
      store.log(mat, 'coordenacao_configurada', '');
      return { ok: true, nome: titulo(nome) };
    });
  }

  // ---------------------------------------------------------------- início

  function aHome(store, ctx) {
    var cfg = ctx.cfg, eu = ctx.eu, hoje = store.hoje();
    var lider = ctx.idx.porMat[ctx.liderMap[eu.mat]] || null;
    var resp = {};
    store.listParticipacao(cfg.ciclo).forEach(function (x) { if (x.form === FORM_UP) resp[x.avaliador] = x; });
    var equipe = ctx.equipes[eu.mat] || [];
    var downs = store.listDown(cfg.ciclo);
    var avaliados = 0;
    if (equipe.length) {
      var feitos = {};
      downs.forEach(function (r) { if (r.avaliador === eu.mat) feitos[r.avaliado] = true; });
      equipe.forEach(function (p) { if (feitos[p.mat]) avaliados++; });
    }
    var meu = null;
    downs.forEach(function (r) { if (r.avaliado === eu.mat) meu = r; });
    var agenda = store.listAgenda(cfg.ciclo);
    var meusEncontros = agenda.filter(function (a) { return a.liderado === eu.mat && a.status === 'AGENDADO' && a.data >= hoje; }).sort(porData);
    var minhaAgenda = agenda.filter(function (a) { return a.lider === eu.mat && a.status === 'AGENDADO'; });
    return {
      eu: {
        mat: eu.mat, nome: titulo(eu.nome), primeiroNome: primeiroNome(eu.nome), cc: str(eu.cc).trim(),
        utd: utdDoCC(eu.cc), perfil: eu.perfil, admin: ctx.isAdmin, lider: equipe.length > 0
      },
      hoje: hoje,
      ciclo: cfg.ciclo,
      cicloRotulo: rotuloCiclo(cfg.ciclo),
      organizacao: cfg.organizacao,
      limiteMensal: cfg.limiteMensal,
      notaCritica: cfg.notaCritica,
      fases: { up: cfg.faseLideradoLider, down: cfg.faseLiderLiderado },
      meuLider: lider ? { nome: titulo(lider.nome), coordenacao: lider.perfil === 'COORDENACAO' } : null,
      avaliouLider: !!resp[eu.mat],
      avaliouLiderEm: resp[eu.mat] ? resp[eu.mat].data : null,
      meuFeedback: meu
        ? { status: meu.dataFeedback && meu.dataFeedback <= hoje ? 'DISPONIVEL' : 'MARCADO', data: meu.dataFeedback, ciencia: !!meu.cienciaEm }
        : { status: 'AGUARDANDO' },
      proximoEncontro: meusEncontros[0] ? { data: meusEncontros[0].data, tipo: meusEncontros[0].tipo } : null,
      equipe: equipe.length ? {
        total: equipe.length,
        responderam: equipe.filter(function (p) { return !!resp[p.mat]; }).length,
        avaliados: avaliados,
        atrasados: minhaAgenda.filter(function (a) { return a.data < hoje; }).length,
        proximos7: minhaAgenda.filter(function (a) { return a.data >= hoje && a.data <= somarDias(hoje, 7); }).length,
        semData: equipe.filter(function (p) { return !agenda.some(function (a) { return a.lider === eu.mat && a.liderado === p.mat && a.tipo === 'FEEDBACK' && a.status !== 'CANCELADO'; }); }).length
      } : null,
      resultadoLiberado: visibilidade(cfg, cfg.ciclo, ctx.isAdmin).ok
    };
  }

  // ---------------------------------------------------------------- notas e "por quê"

  function lerNotas(obj, crits) {
    obj = obj || {};
    var out = {};
    crits.forEach(function (c) {
      var v = Number(obj[c.id]);
      if (!(v >= 1 && v <= 5 && Math.floor(v) === v)) throw erro('INCOMPLETO', 'Dê uma nota de 1 a 5 para todos os itens.', c.id);
      out[c.id] = v;
    });
    return out;
  }
  /** "Por quê" de cada nota: opcional, mas obrigatório nas notas críticas (1 e 2, por padrão). */
  function lerPorques(obj, notas, crits, cfg) {
    obj = obj || {};
    var out = {};
    crits.forEach(function (c) {
      var t = texto(obj[c.id], LIMITE_PORQUE);
      if (t) out[c.id] = t;
      if (cfg.notaCritica > 0 && notas[c.id] <= cfg.notaCritica && t.length < 3) {
        throw erro('JUSTIFICAR', 'Explique o porquê da nota ' + notas[c.id] + ' em "' + c.texto + '".', c.id);
      }
    });
    return out;
  }
  function lerLista(arr, n, msg) {
    var a = (Array.isArray(arr) ? arr : []).map(function (x) { return textoLinha(x, LIMITE_ITEM); }).filter(Boolean);
    if (a.length < n) throw erro('INCOMPLETO', msg);
    return a.slice(0, n);
  }

  // ---------------------------------------------------------------- Liderado x Líder (a equipe avalia o líder)

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
      notaCritica: cfg.notaCritica,
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
    var porques = lerPorques(d.porques, notas, crits, cfg);
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
      var hoje = store.hoje();
      store.addUp({
        id: store.uuid(), ciclo: cfg.ciclo, avaliado: lider.mat, avaliadoNome: lider.nome,
        avaliador: ctx.eu.mat, avaliadorNome: ctx.eu.nome, data: hoje,
        notas: notas, porques: porques, media: media(notas), fortes: fortes, fracos: fracos, consideracoes: consideracoes
      });
      store.addParticipacao({
        ciclo: cfg.ciclo, form: FORM_UP, avaliador: ctx.eu.mat, avaliadorNome: ctx.eu.nome,
        avaliado: lider.mat, avaliadoNome: lider.nome, data: hoje
      });
      store.log(ctx.eu.mat, 'avaliou_lider', lider.mat);
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- equipe do líder

  function aEquipe(store, ctx) {
    var equipe = ctx.equipes[ctx.eu.mat] || [];
    if (!equipe.length) throw erro('PERMISSAO', 'Você não tem liderados cadastrados.');
    var cfg = ctx.cfg, hoje = store.hoje(), info = infoCriterios(store);
    var resp = {};
    store.listParticipacao(cfg.ciclo).forEach(function (x) { if (x.form === FORM_UP) resp[x.avaliador] = true; });
    var down = {};
    store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === ctx.eu.mat) down[r.avaliado] = r; });
    var agenda = store.listAgenda(cfg.ciclo).filter(function (a) { return a.lider === ctx.eu.mat && a.status !== 'CANCELADO'; });
    var ups = store.listUp(cfg.ciclo);
    var mensal = 0, semestral = 0;
    var pessoas = equipe.map(function (p) {
      var r = down[p.mat];
      var lid = ehLider(ctx, p.mat);
      var freq = frequenciaDe(cfg, r, info, lid ? mediaDaEquipe(store, cfg, cfg.ciclo, p.mat, ctx.isAdmin, ups) : null);
      if (freq) { if (freq.tipo === 'MENSAL') mensal++; else semestral++; }
      var minhas = agenda.filter(function (a) { return a.liderado === p.mat; }).sort(porData);
      var prox = minhas.filter(function (a) { return a.status === 'AGENDADO'; })[0] || null;
      return {
        mat: p.mat, nome: titulo(p.nome), cc: str(p.cc).trim(), utd: utdDoCC(p.cc), lider: lid,
        respondeu: !!resp[p.mat], avaliado: !!r, media: r ? r.media : null, ciencia: !!(r && r.cienciaEm),
        frequencia: freq,
        proximo: prox ? { id: prox.id, data: prox.data, tipo: prox.tipo, atrasado: prox.data < hoje } : null,
        realizados: minhas.filter(function (a) { return a.status === 'REALIZADO'; }).length,
        agenda: minhas.map(function (a) { return vAgenda(a, ctx.idx, hoje); })
      };
    }).sort(porNome);
    var meus = Object.keys(down).map(function (k) { return down[k]; });
    return {
      ciclo: cfg.ciclo,
      cicloRotulo: rotuloCiclo(cfg.ciclo),
      hoje: hoje,
      fases: { up: cfg.faseLideradoLider, down: cfg.faseLiderLiderado },
      resultadoLiberado: visibilidade(cfg, cfg.ciclo, ctx.isAdmin).ok,
      pessoas: pessoas,
      painel: {
        avaliados: meus.length, media: mediaGeral(meus), itens: listaItens(mediaPorCriterio(meus), info),
        mensal: mensal, semestral: semestral,
        mensais: pessoas.filter(function (p) { return p.frequencia && p.frequencia.tipo === 'MENSAL'; })
          .map(function (p) { return { mat: p.mat, nome: p.nome, media: p.media, motivos: p.frequencia.motivos }; })
      },
      limiteMensal: cfg.limiteMensal
    };
  }

  // ---------------------------------------------------------------- Líder x Liderado (o líder avalia cada liderado)

  function lideradoDe(ctx, mat) {
    mat = normMat(mat);
    var p = null;
    (ctx.equipes[ctx.eu.mat] || []).forEach(function (x) { if (x.mat === mat) p = x; });
    if (!p) throw erro('PERMISSAO', 'Este colaborador não faz parte da sua equipe.');
    return p;
  }

  function vDown(r) {
    return r ? {
      id: r.id, avaliado: r.avaliado, tipo: r.tipo || 'PADRAO', dataFeedback: r.dataFeedback, dataReavaliacao: r.dataReavaliacao,
      notas: r.notas || {}, obs: r.obs || {}, consideracoes: r.consideracoes || '', media: r.media,
      fortes: r.fortes || [], fracos: r.fracos || [], plano: r.plano || [], cienciaEm: r.cienciaEm || '', atualizadoEm: r.atualizadoEm
    } : null;
  }

  function aFormLiderado(store, ctx, d) {
    var p = lideradoDe(ctx, d.mat);
    var cfg = ctx.cfg, hoje = store.hoje();
    var atual = null;
    store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === ctx.eu.mat && r.avaliado === p.mat) atual = r; });
    var forma = formaAvaliacao(ctx, p), lid = forma.lideranca;
    var marcado = store.listAgenda(cfg.ciclo).filter(function (a) {
      return a.lider === ctx.eu.mat && a.liderado === p.mat && a.tipo === 'FEEDBACK' && a.status === 'AGENDADO';
    }).sort(porData)[0];
    return {
      liderado: vPessoa(p),
      lideranca: lid,
      motivoLideranca: forma.motivo,
      fase: cfg.faseLiderLiderado,
      criterios: criteriosAtivos(store, lid ? FORM_UP : FORM_DOWN),
      extras: lid,
      escala: cfg.escala,
      notaCritica: cfg.notaCritica,
      atual: vDown(atual),
      hoje: hoje,
      dataSugerida: marcado ? marcado.data : hoje,
      ciclo: cfg.ciclo,
      cicloRotulo: rotuloCiclo(cfg.ciclo)
    };
  }

  function aSalvarLiderado(store, ctx, d) {
    var cfg = ctx.cfg;
    if (cfg.faseLiderLiderado !== 'ABERTA') throw erro('FASE_FECHADA', 'A avaliação dos liderados não está aberta no momento.');
    var p = lideradoDe(ctx, d.mat);
    var lid = formaAvaliacao(ctx, p).lideranca;
    var crits = criteriosAtivos(store, lid ? FORM_UP : FORM_DOWN);
    var notas = lerNotas(d.notas, crits);
    var obs = lerPorques(d.obs, notas, crits, cfg);
    var fortes = [], fracos = [];
    if (lid) {
      fortes = lerLista(d.fortes, 3, 'Escreva os 3 pontos fortes.');
      fracos = lerLista(d.fracos, 3, 'Escreva os 3 pontos fracos (o que pode melhorar).');
    }
    var plano = (Array.isArray(d.plano) ? d.plano : []).map(function (x) { return textoLinha(x, 200); }).filter(Boolean).slice(0, 3);
    var dataFeedback = str(d.dataFeedback);
    if (!dataValida(dataFeedback)) throw erro('VALIDACAO', 'Informe a data do feedback.');
    var dataReavaliacao = str(d.dataReavaliacao);
    if (dataReavaliacao && !dataValida(dataReavaliacao)) throw erro('VALIDACAO', 'A data da reavaliação é inválida.');
    if (dataReavaliacao && dataReavaliacao < dataFeedback) throw erro('VALIDACAO', 'A reavaliação precisa ser depois da data do feedback.');
    var consideracoes = texto(d.consideracoes, LIMITE_TEXTO);
    return store.comTrava(function () {
      var existente = null;
      store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === ctx.eu.mat && r.avaliado === p.mat) existente = r; });
      var agora = store.agora(), hoje = store.hoje();
      var rec = {
        id: existente ? existente.id : store.uuid(), ciclo: cfg.ciclo, tipo: lid ? 'LIDERANCA' : 'PADRAO',
        avaliador: ctx.eu.mat, avaliadorNome: ctx.eu.nome, avaliado: p.mat, avaliadoNome: p.nome,
        dataFeedback: dataFeedback, dataReavaliacao: dataReavaliacao,
        notas: notas, media: media(notas), obs: obs, fortes: fortes, fracos: fracos, plano: plano, consideracoes: consideracoes,
        cienciaEm: '', // qualquer alteração pede nova ciência do liderado
        enviadoEm: existente ? existente.enviadoEm : agora, atualizadoEm: agora
      };
      store.saveDown(rec);
      // No cronograma, o feedback marcado passa a "realizado" quando a data da conversa chega.
      if (dataFeedback <= hoje) {
        var doLiderado = store.listAgenda(cfg.ciclo).filter(function (a) {
          return a.lider === ctx.eu.mat && a.liderado === p.mat && a.tipo === 'FEEDBACK' && a.status !== 'CANCELADO';
        }).sort(porData);
        var pendente = doLiderado.filter(function (a) { return a.status === 'AGENDADO'; })[0];
        if (pendente) {
          pendente.status = 'REALIZADO'; pendente.realizadoEm = dataFeedback; pendente.atualizadoEm = agora;
          store.salvarAgenda(pendente);
        } else if (!doLiderado.some(function (a) { return a.status === 'REALIZADO'; })) {
          store.salvarAgenda({
            id: store.uuid(), ciclo: cfg.ciclo, lider: ctx.eu.mat, liderado: p.mat, data: dataFeedback, tipo: 'FEEDBACK',
            status: 'REALIZADO', realizadoEm: dataFeedback, obs: '', atualizadoEm: agora
          });
        }
      }
      store.log(ctx.eu.mat, existente ? 'editou_liderado' : 'avaliou_liderado', p.mat);
      return { ok: true, media: rec.media, frequencia: frequenciaDe(cfg, rec, infoCriterios(store), null) };
    });
  }

  // ---------------------------------------------------------------- feedback recebido (cada pessoa)

  function aMeuFeedback(store, ctx, d) {
    var cfg = ctx.cfg, hoje = store.hoje(), info = infoCriterios(store), eu = ctx.eu;
    var meus = store.listDown().filter(function (r) { return r.avaliado === eu.mat; });
    var visivel = function (r) { return !!(r && r.dataFeedback && r.dataFeedback <= hoje); };
    var ciclos = {};
    ciclos[cfg.ciclo] = true;
    meus.forEach(function (r) { ciclos[r.ciclo] = true; });
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var rec = null;
    meus.forEach(function (r) { if (r.ciclo === ciclo && (!rec || r.atualizadoEm > rec.atualizadoEm)) rec = r; });
    var proximos = store.listAgenda(cfg.ciclo).filter(function (a) { return a.liderado === eu.mat && a.status === 'AGENDADO' && a.data >= hoje; }).sort(porData);
    var out = {
      ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo),
      ciclos: Object.keys(ciclos).sort().reverse().map(function (c) { return { id: c, rotulo: rotuloCiclo(c) }; }),
      historico: meus.filter(visivel).map(function (r) { return { ciclo: r.ciclo, rotulo: rotuloCiclo(r.ciclo), media: r.media }; })
        .sort(function (a, b) { return a.ciclo < b.ciclo ? -1 : 1; }),
      proximo: proximos[0] ? { data: proximos[0].data, tipo: proximos[0].tipo } : null,
      lider: ehLider(ctx, eu.mat)
    };
    if (!rec) { out.status = 'AGUARDANDO'; return out; }
    if (!visivel(rec)) { out.status = 'MARCADO'; out.dataFeedback = rec.dataFeedback; return out; }
    var mediaEq = out.lider ? mediaDaEquipe(store, cfg, ciclo, eu.mat, ctx.isAdmin) : null;
    out.status = 'DISPONIVEL';
    out.feedback = {
      tipo: rec.tipo || 'PADRAO', avaliador: titulo(rec.avaliadorNome), dataFeedback: rec.dataFeedback, dataReavaliacao: rec.dataReavaliacao || '',
      media: rec.media, itens: itensOrdenados(rec.notas, info, rec.obs), fortes: rec.fortes || [], fracos: rec.fracos || [],
      plano: rec.plano || [], consideracoes: rec.consideracoes || '', cienciaEm: rec.cienciaEm || ''
    };
    out.frequencia = frequenciaDe(cfg, rec, info, mediaEq);
    out.mediaEquipe = mediaEq;
    return out;
  }

  function aDarCiencia(store, ctx, d) {
    var cfg = ctx.cfg, hoje = store.hoje(), ciclo = str(d.ciclo) || cfg.ciclo;
    return store.comTrava(function () {
      var rec = null;
      store.listDown(ciclo).forEach(function (r) { if (r.avaliado === ctx.eu.mat) rec = r; });
      if (!rec || !rec.dataFeedback || rec.dataFeedback > hoje) throw erro('VALIDACAO', 'Ainda não há feedback para confirmar.');
      if (rec.cienciaEm) return { ok: true, cienciaEm: rec.cienciaEm };
      rec.cienciaEm = store.agora();
      store.saveDown(rec);
      store.log(ctx.eu.mat, 'ciencia', rec.id);
      return { ok: true, cienciaEm: rec.cienciaEm };
    });
  }

  // ---------------------------------------------------------------- resultado da avaliação do líder

  function visibilidade(cfg, ciclo, isAdmin) {
    if (isAdmin) return { ok: true };
    if (cfg.ciclosLiberados.indexOf(ciclo) < 0) {
      return { ok: false, motivo: 'A coordenação ainda não liberou o resultado deste ciclo. Quando liberar, você vê aqui as notas e o porquê de cada pessoa da equipe.' };
    }
    return { ok: true };
  }

  function consolidar(store, ciclo, liderMat) {
    var info = infoCriterios(store);
    var rs = store.listUp(ciclo).filter(function (r) { return r.avaliado === liderMat; });
    var out = { n: rs.length };
    if (!rs.length) { out.vazio = true; return out; }
    out.media = mediaGeral(rs);
    var porCrit = mediaPorCriterio(rs);
    out.itens = listaItens(porCrit, info).map(function (it) {
      var dist = [0, 0, 0, 0, 0];
      rs.forEach(function (r) { var v = Number((r.notas || {})[it.id]); if (v >= 1 && v <= 5) dist[v - 1]++; });
      it.dist = dist;
      return it;
    });
    out.respostas = rs.map(function (r) {
      return {
        avaliador: r.avaliador || '', avaliadorNome: titulo(r.avaliadorNome || ''), data: r.data || '', media: r.media,
        itens: itensOrdenados(r.notas, info, r.porques), fortes: r.fortes || [], fracos: r.fracos || [], consideracoes: r.consideracoes || ''
      };
    }).sort(function (a, b) { return a.avaliadorNome < b.avaliadorNome ? -1 : 1; });
    var fortes = [], fracos = [];
    rs.forEach(function (r) { fortes = fortes.concat(r.fortes || []); fracos = fracos.concat(r.fracos || []); });
    out.fortes = fortes.filter(Boolean);
    out.fracos = fracos.filter(Boolean);
    return out;
  }

  function aMeusResultados(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var base = { ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg), coordenacao: ctx.eu.perfil === 'COORDENACAO', lider: vPessoa(ctx.eu) };
    var vis = visibilidade(cfg, ciclo, ctx.isAdmin);
    if (!vis.ok) { base.oculto = true; base.motivo = vis.motivo; return base; }
    var r = consolidar(store, ciclo, ctx.eu.mat);
    Object.keys(base).forEach(function (k) { r[k] = base[k]; });
    return r;
  }

  // ---------------------------------------------------------------- cronograma

  function vAgenda(a, idx, hoje) {
    return {
      id: a.id, ciclo: a.ciclo, lider: a.lider, liderNome: idx.porMat[a.lider] ? titulo(idx.porMat[a.lider].nome) : '',
      liderado: a.liderado, lideradoNome: idx.porMat[a.liderado] ? titulo(idx.porMat[a.liderado].nome) : '',
      data: a.data, tipo: a.tipo, status: a.status, realizadoEm: a.realizadoEm || '', obs: a.obs || '',
      atrasado: a.status === 'AGENDADO' && a.data < hoje
    };
  }

  function aGerarAgenda(store, ctx, d) {
    var equipe = ctx.equipes[ctx.eu.mat] || [];
    if (!equipe.length) throw erro('PERMISSAO', 'Você não tem liderados cadastrados.');
    var cfg = ctx.cfg, hoje = store.hoje(), info = infoCriterios(store);
    var porDia = Math.max(1, Math.min(20, Math.floor(Number(d.porDia) || 4)));
    var inicio = dataValida(d.inicio) && d.inicio >= hoje ? d.inicio : somarDias(hoje, 1);
    return store.comTrava(function () {
      var itens = store.listAgenda(cfg.ciclo).filter(function (a) { return a.lider === ctx.eu.mat && a.status !== 'CANCELADO'; });
      var downs = {};
      store.listDown(cfg.ciclo).forEach(function (r) { if (r.avaliador === ctx.eu.mat) downs[r.avaliado] = r; });
      var ups = store.listUp(cfg.ciclo);
      var dia = diaUtil(inicio), noDia = 0, feedbacks = 0, acompanhamentos = 0, agora = store.agora();
      var novo = function (p, data, tipo) {
        store.salvarAgenda({ id: store.uuid(), ciclo: cfg.ciclo, lider: ctx.eu.mat, liderado: p.mat, data: data, tipo: tipo, status: 'AGENDADO', realizadoEm: '', obs: '', atualizadoEm: agora });
      };
      equipe.slice().sort(function (a, b) { return a.nome < b.nome ? -1 : 1; }).forEach(function (p) {
        var doLiderado = itens.filter(function (a) { return a.liderado === p.mat; });
        var rec = downs[p.mat];
        if (!rec && !doLiderado.some(function (a) { return a.tipo === 'FEEDBACK'; })) {
          if (noDia >= porDia) { dia = diaUtil(somarDias(dia, 1)); noDia = 0; }
          novo(p, dia, 'FEEDBACK');
          noDia++; feedbacks++;
        }
        var freq = frequenciaDe(cfg, rec, info, ehLider(ctx, p.mat) ? mediaDaEquipe(store, cfg, cfg.ciclo, p.mat, ctx.isAdmin, ups) : null);
        var temFuturo = doLiderado.some(function (a) { return a.tipo === 'ACOMPANHAMENTO' && a.status === 'AGENDADO' && a.data >= hoje; });
        if (freq && freq.tipo === 'MENSAL' && !temFuturo) {
          var base = rec.dataFeedback || hoje;
          for (var m = 1, criados = 0; m <= 8 && criados < 5; m++) {
            var data = diaUtil(somarMeses(base, m));
            if (data <= hoje) continue;
            novo(p, data, 'ACOMPANHAMENTO');
            criados++; acompanhamentos++;
          }
        }
      });
      store.log(ctx.eu.mat, 'agenda_gerada', feedbacks + ' feedbacks, ' + acompanhamentos + ' acompanhamentos');
      return { ok: true, feedbacks: feedbacks, acompanhamentos: acompanhamentos };
    });
  }

  function aSalvarAgenda(store, ctx, d) {
    var cfg = ctx.cfg;
    var p = lideradoDe(ctx, d.liderado);
    var data = str(d.data);
    if (!dataValida(data)) throw erro('VALIDACAO', 'Informe a data do encontro.');
    var tipo = TIPOS_AGENDA[d.tipo] ? d.tipo : 'FEEDBACK';
    var status = STATUS_AGENDA[d.status] ? d.status : 'AGENDADO';
    var hoje = store.hoje();
    var realizadoEm = '';
    if (status === 'REALIZADO') {
      realizadoEm = dataValida(d.realizadoEm) ? d.realizadoEm : hoje;
      if (realizadoEm > hoje) throw erro('VALIDACAO', 'A data em que o feedback foi feito não pode ser no futuro.');
    }
    return store.comTrava(function () {
      var atual = null;
      if (d.id) {
        store.listAgenda(cfg.ciclo).forEach(function (a) { if (a.id === d.id) atual = a; });
        if (!atual || atual.lider !== ctx.eu.mat || atual.liderado !== p.mat) throw erro('PERMISSAO', 'Item do cronograma não encontrado.');
      }
      var rec = {
        id: atual ? atual.id : store.uuid(), ciclo: cfg.ciclo, lider: ctx.eu.mat, liderado: p.mat, data: data, tipo: tipo,
        status: status, realizadoEm: realizadoEm, obs: textoLinha(d.obs, 300), atualizadoEm: store.agora()
      };
      store.salvarAgenda(rec);
      store.log(ctx.eu.mat, atual ? 'agenda_editada' : 'agenda_criada', p.mat + ' ' + data + ' ' + status);
      return { ok: true, item: vAgenda(rec, ctx.idx, hoje) };
    });
  }

  function aAgendaGeral(store, ctx, d) {
    var cfg = ctx.cfg, hoje = store.hoje(), idx = ctx.idx;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var itens = store.listAgenda(ciclo).filter(function (a) { return a.status !== 'CANCELADO'; });
    var em7 = somarDias(hoje, 7);
    var lideres = Object.keys(ctx.equipes).map(function (m) { return idx.porMat[m]; }).filter(Boolean).map(function (l) {
      var eq = ctx.equipes[l.mat];
      var meus = itens.filter(function (a) { return a.lider === l.mat; });
      return {
        mat: l.mat, nome: titulo(l.nome), equipe: eq.length,
        comData: eq.filter(function (p) { return meus.some(function (a) { return a.liderado === p.mat && a.tipo === 'FEEDBACK'; }); }).length,
        agendados: meus.filter(function (a) { return a.status === 'AGENDADO'; }).length,
        realizados: meus.filter(function (a) { return a.status === 'REALIZADO'; }).length,
        atrasados: meus.filter(function (a) { return a.status === 'AGENDADO' && a.data < hoje; }).length,
        proximos7: meus.filter(function (a) { return a.status === 'AGENDADO' && a.data >= hoje && a.data <= em7; }).length
      };
    }).sort(function (a, b) { return b.equipe - a.equipe || (a.nome < b.nome ? -1 : 1); });
    var lista = itens.map(function (a) { return vAgenda(a, idx, hoje); }).sort(porData);
    return {
      ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg), hoje: hoje,
      lideres: lideres, itens: lista,
      totais: {
        agendados: lista.filter(function (a) { return a.status === 'AGENDADO'; }).length,
        realizados: lista.filter(function (a) { return a.status === 'REALIZADO'; }).length,
        atrasados: lista.filter(function (a) { return a.atrasado; }).length,
        proximos7: lista.filter(function (a) { return a.status === 'AGENDADO' && a.data >= hoje && a.data <= em7; }).length
      }
    };
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
    var ativos = ctx.pessoas.filter(function (p) { return p.ativo; });
    var comLider = ativos.filter(function (p) { return !!ctx.liderMap[p.mat]; });
    var lideres = Object.keys(ctx.equipes).map(function (mat) { return ctx.idx.porMat[mat]; }).filter(Boolean);
    var linhas = lideres.map(function (l) {
      var eq = ctx.equipes[l.mat];
      var recebidas = ups.filter(function (r) { return r.avaliado === l.mat; });
      var downs = eq.map(function (p) { return m.down[l.mat + '>' + p.mat]; }).filter(Boolean);
      return {
        mat: l.mat, nome: titulo(l.nome), perfil: l.perfil, utd: utdDoCC(l.cc), equipe: eq.length,
        responderam: eq.filter(function (p) { return !!m.resp[p.mat]; }).length,
        avaliados: downs.length, mediaUp: mediaGeral(recebidas), nRespostas: recebidas.length, mediaDown: mediaGeral(downs)
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
      liberado: cfg.ciclosLiberados.indexOf(ciclo) >= 0
    };
  }

  function aParticipacao(store, ctx, d) {
    var cfg = ctx.cfg, info = infoCriterios(store);
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var m = mapasCiclo(store, ciclo);
    var ups = store.listUp(ciclo);
    var pessoas = ctx.pessoas.filter(function (p) { return p.ativo; }).map(function (p) {
      var l = ctx.idx.porMat[ctx.liderMap[p.mat]];
      var r = l ? m.down[l.mat + '>' + p.mat] : null;
      var freq = frequenciaDe(cfg, r, info, ehLider(ctx, p.mat) ? mediaDaEquipe(store, cfg, ciclo, p.mat, true, ups) : null);
      return {
        mat: p.mat, nome: titulo(p.nome), cc: str(p.cc).trim(), utd: utdDoCC(p.cc), perfil: p.perfil,
        lider: l ? titulo(l.nome) : '', liderMat: l ? l.mat : '',
        respondeu: !!m.resp[p.mat], respondeuEm: m.resp[p.mat] ? m.resp[p.mat].data : null,
        avaliado: !!r, mediaDown: r ? r.media : null, ciencia: !!(r && r.cienciaEm), frequencia: freq ? freq.tipo : null
      };
    }).sort(porNome);
    return { ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg), pessoas: pessoas };
  }

  function aResultadoLider(store, ctx, d) {
    var cfg = ctx.cfg;
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var l = ctx.idx.porMat[normMat(d.lider)];
    if (!l) throw erro('VALIDACAO', 'Líder não encontrado.');
    var r = consolidar(store, ciclo, l.mat);
    r.ciclo = ciclo; r.cicloRotulo = rotuloCiclo(ciclo); r.lider = vPessoa(l); r.coordenacao = l.perfil === 'COORDENACAO';
    return r;
  }

  function aLiderLiderado(store, ctx, d) {
    var cfg = ctx.cfg, info = infoCriterios(store);
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var downs = store.listDown(ciclo);
    var idx = ctx.idx, ups = store.listUp(ciclo);
    return {
      ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg),
      registros: downs.map(function (r) {
        var av = idx.porMat[r.avaliado];
        var freq = frequenciaDe(cfg, r, info, av && ehLider(ctx, av.mat) ? mediaDaEquipe(store, cfg, ciclo, av.mat, true, ups) : null);
        return {
          id: r.id, tipo: r.tipo || 'PADRAO', avaliador: r.avaliador, avaliadorNome: titulo(r.avaliadorNome || (idx.porMat[r.avaliador] || {}).nome),
          avaliado: r.avaliado, avaliadoNome: titulo(r.avaliadoNome || (av || {}).nome), utd: utdDoCC(av ? av.cc : ''),
          dataFeedback: r.dataFeedback, dataReavaliacao: r.dataReavaliacao, media: r.media,
          itens: itensOrdenados(r.notas, info, r.obs), fortes: r.fortes || [], fracos: r.fracos || [], plano: r.plano || [],
          consideracoes: r.consideracoes || '', cienciaEm: r.cienciaEm || '', atualizadoEm: r.atualizadoEm, frequencia: freq
        };
      }).sort(function (a, b) { return a.avaliadoNome < b.avaliadoNome ? -1 : 1; })
    };
  }

  // ---------------------------------------------------------------- análises para o RH

  function aAnalises(store, ctx, d) {
    var cfg = ctx.cfg, idx = ctx.idx, info = infoCriterios(store), hoje = store.hoje();
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var ups = store.listUp(ciclo);
    var downs = store.listDown(ciclo);
    var nomeDe = function (mat, alt) { return idx.porMat[mat] ? titulo(idx.porMat[mat].nome) : titulo(alt || mat); };
    var mapaItens = function (rs) { var o = {}; var pc = mediaPorCriterio(rs); Object.keys(pc).forEach(function (k) { o[k] = pc[k].media; }); return o; };

    // 1) A equipe avaliando o líder
    var porLider = {};
    ups.forEach(function (r) { (porLider[r.avaliado] = porLider[r.avaliado] || []).push(r); });
    var liderancas = {
      n: ups.length, media: mediaGeral(ups), itens: listaItens(mediaPorCriterio(ups), info),
      lideres: Object.keys(porLider).map(function (m) {
        return { mat: m, nome: nomeDe(m, porLider[m][0].avaliadoNome), n: porLider[m].length, media: mediaGeral(porLider[m]), itens: mapaItens(porLider[m]) };
      }).sort(function (a, b) { return a.media - b.media; })
    };
    // 2) Avaliações de liderança: o gestor avaliando quem lidera equipe e quem responde direto à coordenação
    var dLid = downs.filter(function (r) { return r.tipo === 'LIDERANCA'; });
    var gestao = {
      n: dLid.length, media: mediaGeral(dLid), itens: listaItens(mediaPorCriterio(dLid), info),
      registros: dLid.map(function (r) {
        return { mat: r.avaliado, nome: nomeDe(r.avaliado, r.avaliadoNome), avaliador: nomeDe(r.avaliador, r.avaliadorNome), media: r.media, fortes: r.fortes || [], fracos: r.fracos || [] };
      }).sort(function (a, b) { return a.media - b.media; })
    };
    // 3) Os líderes avaliando os liderados
    var dPad = downs.filter(function (r) { return r.tipo !== 'LIDERANCA'; });
    var porEquipe = {};
    dPad.forEach(function (r) { (porEquipe[r.avaliador] = porEquipe[r.avaliador] || []).push(r); });
    var mediaLiderados = mediaGeral(dPad);
    var liderados = {
      n: dPad.length, media: mediaLiderados, itens: listaItens(mediaPorCriterio(dPad), info),
      equipes: Object.keys(porEquipe).map(function (m) {
        return { mat: m, nome: nomeDe(m, porEquipe[m][0].avaliadorNome), n: porEquipe[m].length, media: mediaGeral(porEquipe[m]), itens: mapaItens(porEquipe[m]) };
      }).sort(function (a, b) { return a.media - b.media; }),
      faixas: [['abaixo de 2,5', 0, 2.5], ['de 2,5 a 3,4', 2.5, 3.5], ['de 3,5 a 4,4', 3.5, 4.5], ['4,5 ou mais', 4.5, 99]].map(function (f) {
        return { rotulo: f[0], n: dPad.filter(function (r) { return r.media >= f[1] && r.media < f[2]; }).length };
      })
    };
    // 4) Frequência do feedback
    var lista = [], mensal = 0, semestral = 0;
    downs.forEach(function (r) {
      var p = idx.porMat[r.avaliado];
      var f = frequenciaDe(cfg, r, info, p && ehLider(ctx, p.mat) ? mediaDaEquipe(store, cfg, ciclo, p.mat, true, ups) : null);
      if (!f) return;
      if (f.tipo === 'MENSAL') {
        mensal++;
        lista.push({ mat: r.avaliado, nome: nomeDe(r.avaliado, r.avaliadoNome), lider: nomeDe(r.avaliador, r.avaliadorNome), media: r.media, motivos: f.motivos });
      } else semestral++;
    });
    var comLider = ctx.pessoas.filter(function (p) { return p.ativo && ctx.liderMap[p.mat]; }).length;
    var frequencia = {
      mensal: mensal, semestral: semestral, semAvaliacao: Math.max(0, comLider - mensal - semestral),
      lista: lista.sort(function (a, b) { return a.media - b.media; }), limite: cfg.limiteMensal, notaCritica: cfg.notaCritica
    };
    // 5) Comparação com o ciclo anterior
    var ids = ciclosDisponiveis(store, cfg).map(function (c) { return c.id; }).sort();
    var pos = ids.indexOf(ciclo);
    var anterior = pos > 0 ? ids[pos - 1] : null;
    var comparacao = null;
    if (anterior) {
      var upsA = store.listUp(anterior), dA = store.listDown(anterior).filter(function (r) { return r.tipo !== 'LIDERANCA'; });
      comparacao = {
        ciclo: anterior, rotulo: rotuloCiclo(anterior),
        liderancas: { media: mediaGeral(upsA), itens: mapaItens(upsA) },
        liderados: { media: mediaGeral(dA), itens: mapaItens(dA) }
      };
    }
    // 6) Cronograma
    var ag = store.listAgenda(ciclo).filter(function (a) { return a.status !== 'CANCELADO'; });
    var cronograma = {
      agendados: ag.filter(function (a) { return a.status === 'AGENDADO'; }).length,
      realizados: ag.filter(function (a) { return a.status === 'REALIZADO'; }).length,
      atrasados: ag.filter(function (a) { return a.status === 'AGENDADO' && a.data < hoje; }).length
    };
    // 7) Pontos de atenção, em frases
    var destaques = [];
    var piores = function (itens) { return itens.slice().sort(function (a, b) { return a.media - b.media; }).slice(0, 3); };
    if (liderancas.itens.length) destaques.push('Lideranças: os itens mais fracos são ' + piores(liderancas.itens).map(function (x) { return x.texto + ' (' + fmt1(x.media) + ')'; }).join(', ') + '.');
    if (liderados.itens.length) destaques.push('Liderados: os itens mais fracos são ' + piores(liderados.itens).map(function (x) { return x.texto + ' (' + fmt1(x.media) + ')'; }).join(', ') + '.');
    if (mensal) destaques.push(mensal + (mensal === 1 ? ' pessoa precisa' : ' pessoas precisam') + ' de acompanhamento mensal.');
    if (cronograma.atrasados) destaques.push(cronograma.atrasados + (cronograma.atrasados === 1 ? ' feedback do cronograma está atrasado.' : ' feedbacks do cronograma estão atrasados.'));
    if (comparacao) {
      var quedas = liderados.itens.map(function (x) {
        var antes = comparacao.liderados.itens[x.id];
        return antes === undefined ? null : { texto: x.texto, delta: arred(x.media - antes, 2) };
      }).filter(function (x) { return x && x.delta <= -0.3; }).sort(function (a, b) { return a.delta - b.delta; });
      if (quedas.length) destaques.push('Caiu em relação a ' + comparacao.rotulo + ': ' + quedas.slice(0, 3).map(function (q) { return q.texto + ' (' + fmt1(q.delta) + ')'; }).join(', ') + '.');
    }
    if (mediaLiderados !== null) {
      liderados.equipes.forEach(function (e) {
        if (e.n >= 5 && Math.abs(e.media - mediaLiderados) >= 0.7) {
          destaques.push('As notas que ' + e.nome + ' deu à equipe (média ' + fmt1(e.media) + ') estão bem ' + (e.media > mediaLiderados ? 'acima' : 'abaixo') +
            ' da média geral (' + fmt1(mediaLiderados) + '). Vale conferir se os líderes estão usando a escala do mesmo jeito.');
        }
      });
    }
    return {
      ciclo: ciclo, cicloRotulo: rotuloCiclo(ciclo), ciclos: ciclosDisponiveis(store, cfg),
      liderancas: liderancas, gestao: gestao, liderados: liderados, frequencia: frequencia,
      comparacao: comparacao, cronograma: cronograma, destaques: destaques
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
          cpfHash = opts.simular ? 'ok' : hashCpf(store, mat, cpf);
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
    if (d.limiteMensal !== undefined) {
      var lm = Number(String(d.limiteMensal).replace(',', '.'));
      if (!(lm >= 1 && lm <= 5)) throw erro('VALIDACAO', 'O limite para acompanhamento mensal deve ficar entre 1 e 5.');
      novo.limiteMensal = arred(lm, 1);
    }
    if (d.notaCritica !== undefined) {
      var nc = Math.floor(Number(d.notaCritica));
      if (!(nc >= 0 && nc <= 4)) throw erro('VALIDACAO', 'A nota crítica deve ficar entre 0 (desligada) e 4.');
      novo.notaCritica = nc;
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
      var nciclo = str(d.novoCiclo).trim();
      if (!/^\d{4}-[12]$/.test(nciclo)) throw erro('VALIDACAO', 'Use o formato ANO-SEMESTRE, por exemplo 2027-1.');
      if (nciclo === cfg.ciclo) throw erro('VALIDACAO', 'Esse já é o ciclo atual.');
      novo.ciclo = nciclo;
      novo.faseLideradoLider = 'FECHADA';
      novo.faseLiderLiderado = 'FECHADA';
    }
    if (d.organizacao) novo.organizacao = textoLinha(d.organizacao, 80);
    if (!Object.keys(novo).length) throw erro('VALIDACAO', 'Nada para salvar.');
    store.setConfig(novo);
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

  function juntarItens(itens, campo) {
    return itens.map(function (it) { return it.texto + ': ' + it[campo]; }).join(' | ');
  }

  function aExportar(store, ctx, d) {
    var cfg = ctx.cfg, info = infoCriterios(store);
    var ciclo = str(d.ciclo) || cfg.ciclo;
    var tipo = str(d.tipo);
    var idx = ctx.idx;
    var nomeDe = function (mat, alt) { return idx.porMat[mat] ? titulo(idx.porMat[mat].nome) : titulo(alt || ''); };
    var colunasCriterios = function (registros) {
      var usados = {};
      registros.forEach(function (r) { Object.keys(r.notas || {}).forEach(function (k) { usados[k] = true; }); });
      return Object.keys(usados).map(function (id) { return { id: id, texto: info[id] ? info[id].texto : id, ordem: info[id] ? info[id].ordem : 999 }; })
        .sort(function (a, b) { return a.ordem - b.ordem; });
    };
    var porquesTexto = function (r, campo) {
      var p = r[campo] || {};
      return Object.keys(p).map(function (k) { return (info[k] ? info[k].texto : k) + ': ' + p[k]; }).join(' | ');
    };
    if (tipo === 'participacao') {
      var p = aParticipacao(store, ctx, { ciclo: ciclo }).pessoas;
      return {
        arquivo: 'participacao_' + ciclo,
        cabecalho: ['Ciclo', 'Matrícula', 'Nome', 'C.C', 'UTD', 'Líder', 'Avaliou o líder', 'Data', 'Avaliado pelo líder', 'Média recebida', 'Ciência', 'Frequência'],
        linhas: p.map(function (x) {
          return [ciclo, x.mat, x.nome, x.cc, x.utd, x.lider, x.respondeu ? 'Sim' : 'Não', x.respondeuEm || '', x.avaliado ? 'Sim' : 'Não',
            x.mediaDown == null ? '' : x.mediaDown, x.ciencia ? 'Sim' : 'Não', x.frequencia === 'MENSAL' ? 'Mensal' : x.frequencia === 'SEMESTRAL' ? 'Semestral' : ''];
        })
      };
    }
    if (tipo === 'liderado_lider') {
      var ups = store.listUp(ciclo);
      var cu = colunasCriterios(ups);
      return {
        arquivo: 'liderado_x_lider_' + ciclo,
        cabecalho: ['Ciclo', 'Líder avaliado', 'Matrícula do líder', 'Quem avaliou', 'Matrícula', 'Data', 'Média']
          .concat(cu.map(function (c) { return c.texto; }), ['Por quê', 'Pontos fortes', 'Pontos fracos', 'Considerações finais']),
        linhas: ups.map(function (r) {
          return [ciclo, nomeDe(r.avaliado, r.avaliadoNome), r.avaliado, nomeDe(r.avaliador, r.avaliadorNome), r.avaliador || '', r.data || '', r.media]
            .concat(cu.map(function (c) { return (r.notas || {})[c.id] || ''; }),
              [porquesTexto(r, 'porques'), (r.fortes || []).join(' | '), (r.fracos || []).join(' | '), r.consideracoes || '']);
        })
      };
    }
    if (tipo === 'lider_liderado') {
      var downs = store.listDown(ciclo);
      var cd = colunasCriterios(downs);
      var ll = aLiderLiderado(store, ctx, { ciclo: ciclo }).registros;
      var freqPorId = {};
      ll.forEach(function (x) { freqPorId[x.id] = x.frequencia; });
      return {
        arquivo: 'lider_x_liderado_' + ciclo,
        cabecalho: ['Ciclo', 'Tipo', 'Líder', 'Matrícula do líder', 'Liderado', 'Matrícula do liderado', 'Data do feedback', 'Data da reavaliação', 'Média']
          .concat(cd.map(function (c) { return c.texto; }), ['Por quê', 'Pontos fortes', 'Pontos fracos', 'Plano de ação', 'Considerações finais', 'Ciência', 'Frequência']),
        linhas: downs.map(function (r) {
          var f = freqPorId[r.id];
          return [ciclo, r.tipo === 'LIDERANCA' ? 'Liderança' : 'Liderado', nomeDe(r.avaliador, r.avaliadorNome), r.avaliador, nomeDe(r.avaliado, r.avaliadoNome), r.avaliado,
            r.dataFeedback || '', r.dataReavaliacao || '', r.media]
            .concat(cd.map(function (c) { return (r.notas || {})[c.id] || ''; }),
              [porquesTexto(r, 'obs'), (r.fortes || []).join(' | '), (r.fracos || []).join(' | '), (r.plano || []).join(' | '), r.consideracoes || '',
                r.cienciaEm ? r.cienciaEm.slice(0, 10) : '', f ? (f.tipo === 'MENSAL' ? 'Mensal: ' + f.motivos.join('; ') : 'Semestral') : '']);
        })
      };
    }
    if (tipo === 'cronograma') {
      var g = aAgendaGeral(store, ctx, { ciclo: ciclo });
      return {
        arquivo: 'cronograma_' + ciclo,
        cabecalho: ['Ciclo', 'Líder', 'Liderado', 'Matrícula', 'Tipo', 'Data marcada', 'Situação', 'Feito em', 'Observação'],
        linhas: g.itens.map(function (a) {
          return [ciclo, a.liderNome, a.lideradoNome, a.liderado, TIPOS_AGENDA[a.tipo] || a.tipo, a.data,
            a.atrasado ? 'Atrasado' : (STATUS_AGENDA[a.status] || a.status), a.realizadoEm, a.obs];
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
    meuFeedback: { fn: aMeuFeedback },
    darCiencia: { fn: aDarCiencia },
    gerarAgenda: { fn: aGerarAgenda },
    salvarAgenda: { fn: aSalvarAgenda },
    painel: { fn: aPainel, admin: true },
    participacao: { fn: aParticipacao, admin: true },
    resultadoLider: { fn: aResultadoLider, admin: true },
    liderLiderado: { fn: aLiderLiderado, admin: true },
    agendaGeral: { fn: aAgendaGeral, admin: true },
    analises: { fn: aAnalises, admin: true },
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
      if (acao === 'configurarCoordenacao') return { ok: true, data: aConfigurarCoordenacao(store, dados) };
      var a = ACOES[acao];
      if (!a) throw erro('ACAO', 'Ação desconhecida.');
      var ctx = sessao(store, token);
      if (a.admin && !ctx.isAdmin) throw erro('PERMISSAO', 'Acesso restrito à coordenação e ao RH.');
      return { ok: true, data: a.fn(store, ctx, dados) };
    } catch (e) {
      if (e && e.code) {
        var r = { ok: false, code: e.code, message: e.message };
        if (e.campo) r.campo = e.campo;
        return r;
      }
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
    somarMeses: somarMeses,
    somarDias: somarDias,
    diaUtil: diaUtil,
    frequenciaDe: frequenciaDe,
    CRITERIOS_PADRAO: CRITERIOS_PADRAO,
    CONFIG_PADRAO: CONFIG_PADRAO,
    FORM_UP: FORM_UP,
    FORM_DOWN: FORM_DOWN,
    PERFIS: PERFIS
  };
})();



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



/**
 * Feedback Semestral · servidor no Supabase (Edge Function "feedback", Deno)
 *
 * Roda exatamente as mesmas regras do núcleo (FeedbackCore) usadas no Apps Script.
 * Cada pedido abre uma transação: lê o banco, aplica as regras em memória e grava só o que mudou.
 * Pedidos que gravam passam por uma trava (pg_advisory_xact_lock), para não haver gravação duplicada.
 * O banco fica fechado para a API pública (RLS sem políticas): só esta função lê e grava.
 *
 * Pedido:   POST {acao, dados, token}  (texto JSON, sem cabeçalhos especiais)
 * Resposta: {ok: true, data} ou {ok: false, code, message}
 */

var FUSO = 'America/Bahia';
var TRAVA = 727274;
var ACOES_QUE_GRAVAM = {
  login: 1, sair: 1, enviarLider: 1, salvarLiderado: 1, salvarPessoa: 1, importar: 1,
  salvarConfig: 1, salvarCriterio: 1, configurarCoordenacao: 1, darCiencia: 1, gerarAgenda: 1, salvarAgenda: 1
};
var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400'
};

// ------------------------------------------------------------------ partes puras (testáveis sem banco)

function partesData(d, comHora) {
  var opcoes = { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' };
  if (comHora) { opcoes.hour = '2-digit'; opcoes.minute = '2-digit'; opcoes.second = '2-digit'; opcoes.hourCycle = 'h23'; }
  var p = {};
  new Intl.DateTimeFormat('en-CA', opcoes).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
  return p;
}
function hojeBahia(d) { var p = partesData(d || new Date(), false); return p.year + '-' + p.month + '-' + p.day; }
function agoraBahia(d) {
  var p = partesData(d || new Date(), true);
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second;
}

/** A tabela de cache guarda só o hash da chave: tokens de sessão nunca ficam em texto no banco. */
function hashChave(k) { return Sha256('cache|' + k); }

/** Chaves de cache que as regras podem ler neste pedido (as regras são síncronas: carregamos antes). */
function chavesDoPedido(acao, dados, token) {
  var chaves = [];
  if (token) chaves.push('s:' + token);
  if (dados && dados.mat) chaves.push('f:' + FeedbackCore.normMat(dados.mat));
  if (acao === 'configurarCoordenacao') chaves.push('cfg:tentativas');
  return chaves;
}

function numeroOuNulo(v) { return v === null || v === undefined || v === '' ? null : Number(v); }

/** Converte as linhas lidas do banco no estado usado pelas regras. */
function montarEstado(linhas, chaves) {
  var segredos = {};
  (linhas.segredos || []).forEach(function (r) { segredos[r.nome] = r.valor; });
  if (!segredos.pepper) throw new Error('Segredo do CPF ausente no banco (tabela segredos).');
  var porHash = {};
  (linhas.cache || []).forEach(function (r) { porHash[r.chave] = r; });
  var cache = {};
  (chaves || []).forEach(function (k) {
    var r = porHash[hashChave(k)];
    if (r) cache[k] = { v: String(r.valor), exp: Number(r.exp) };
  });
  var config = {};
  (linhas.config || []).forEach(function (r) { config[r.chave] = r.valor; });
  return {
    segredo: segredos.pepper,
    codigoConfiguracao: segredos.codigo_configuracao || '',
    config: config,
    pessoas: (linhas.pessoas || []).map(function (r) {
      return {
        mat: r.mat, nome: r.nome, cc: r.cc || '', liderMat: r.lider_mat || '', liderNome: r.lider_nome || '',
        perfil: r.perfil, ativo: r.ativo !== false, cpfHash: r.cpf_hash || '', atualizadoEm: r.atualizado_em || ''
      };
    }),
    criterios: (linhas.criterios || []).map(function (r) {
      return { id: r.id, form: r.form, ordem: Number(r.ordem) || 0, texto: r.texto, ativo: r.ativo !== false };
    }),
    participacao: (linhas.participacao || []).map(function (r) {
      return { ciclo: r.ciclo, form: r.form, avaliador: r.avaliador, avaliadorNome: r.avaliador_nome, avaliado: r.avaliado, avaliadoNome: r.avaliado_nome, data: r.data };
    }),
    up: (linhas.respostas || []).map(function (r) {
      return {
        id: r.id, ciclo: r.ciclo, avaliado: r.avaliado, avaliadoNome: r.avaliado_nome, avaliador: r.avaliador || '', avaliadorNome: r.avaliador_nome || '',
        data: r.data || '', media: numeroOuNulo(r.media), notas: r.notas || {}, porques: r.porques || {},
        fortes: r.fortes || [], fracos: r.fracos || [], consideracoes: r.consideracoes || ''
      };
    }),
    down: (linhas.liderados || []).map(function (r) {
      return {
        id: r.id, ciclo: r.ciclo, tipo: r.tipo || 'PADRAO', avaliador: r.avaliador, avaliadorNome: r.avaliador_nome, avaliado: r.avaliado,
        avaliadoNome: r.avaliado_nome, dataFeedback: r.data_feedback, dataReavaliacao: r.data_reavaliacao, media: numeroOuNulo(r.media),
        notas: r.notas || {}, obs: r.obs || {}, fortes: r.fortes || [], fracos: r.fracos || [], plano: r.plano || [],
        consideracoes: r.consideracoes || '', cienciaEm: r.ciencia_em || '', enviadoEm: r.enviado_em || '', atualizadoEm: r.atualizado_em || ''
      };
    }),
    agenda: (linhas.agenda || []).map(function (r) {
      return {
        id: r.id, ciclo: r.ciclo, lider: r.lider, liderado: r.liderado, data: r.data, tipo: r.tipo, status: r.status,
        realizadoEm: r.realizado_em || '', obs: r.obs || '', atualizadoEm: r.atualizado_em || ''
      };
    }),
    logs: [],
    cache: cache
  };
}

/** Armazenamento em memória que anota cada gravação, para depois repetir no banco. */
function lojaRegistrada(estado, ops, relogio) {
  var base = MemoryStore(estado, relogio ? { relogio: relogio } : {});
  var loja = Object.assign({}, base);
  loja.setConfig = function (o) { base.setConfig(o); ops.push({ tipo: 'config', dados: o }); };
  loja.salvarPessoa = function (p) { base.salvarPessoa(p); ops.push({ tipo: 'pessoa', dados: p }); };
  loja.substituirPessoas = function (l) { base.substituirPessoas(l); ops.push({ tipo: 'pessoas', dados: l }); };
  loja.salvarCriterios = function (l) { base.salvarCriterios(l); ops.push({ tipo: 'criterios', dados: l }); };
  loja.addParticipacao = function (r) { base.addParticipacao(r); ops.push({ tipo: 'participacao', dados: r }); };
  loja.addUp = function (r) { base.addUp(r); ops.push({ tipo: 'up', dados: r }); };
  loja.saveDown = function (r) { base.saveDown(r); ops.push({ tipo: 'down', dados: r }); };
  loja.salvarAgenda = function (r) { base.salvarAgenda(r); ops.push({ tipo: 'agenda', dados: r }); };
  loja.log = function (mat, evento, detalhe) { ops.push({ tipo: 'log', dados: { mat: mat || '', evento: evento || '', detalhe: String(detalhe || '').slice(0, 300) } }); };
  loja.cachePut = function (k, v, seg) { base.cachePut(k, v, seg); ops.push({ tipo: 'cachePut', chave: k, valor: String(v), seg: Math.max(1, Math.floor(seg)) }); };
  loja.cacheDel = function (k) { base.cacheDel(k); ops.push({ tipo: 'cacheDel', chave: k }); };
  loja.codigoConfiguracao = function () { return estado.codigoConfiguracao || ''; };
  loja.hoje = function () { return hojeBahia(relogio ? relogio() : new Date()); };
  loja.agora = function () { return agoraBahia(relogio ? relogio() : new Date()); };
  loja.erro = function (e) { console.error(e && e.stack ? e.stack : e); };
  return loja;
}

/** Participação vai primeiro: a chave primária do banco barra envio duplicado ao mesmo tempo. */
function ordenarOps(ops) {
  return ops.filter(function (o) { return o.tipo === 'participacao'; }).concat(ops.filter(function (o) { return o.tipo !== 'participacao'; }));
}

function linhaPessoa(p) {
  return {
    mat: p.mat, nome: p.nome, cc: p.cc || '', lider_mat: p.liderMat || '', lider_nome: p.liderNome || '',
    perfil: p.perfil || 'COLABORADOR', ativo: p.ativo !== false, cpf_hash: p.cpfHash || '', atualizado_em: p.atualizadoEm || ''
  };
}

/** Executa um pedido inteiro sobre um "repositório" (banco real ou falso nos testes). */
async function executarPedido(repo, corpo, relogio) {
  var acao = String((corpo && corpo.acao) || '');
  var dados = corpo && corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
  var token = corpo && typeof corpo.token === 'string' ? corpo.token : '';
  var chaves = chavesDoPedido(acao, dados, token);
  try {
    return await repo.transacao(!!ACOES_QUE_GRAVAM[acao], async function (tx) {
      var linhas = await tx.ler(chaves.map(hashChave));
      var estado = montarEstado(linhas, chaves);
      var ops = [];
      var resposta = FeedbackCore.handle(lojaRegistrada(estado, ops, relogio), acao, dados, token);
      await tx.gravar(ordenarOps(ops));
      return resposta;
    });
  } catch (e) {
    if (e && e.codigoFeedback === 'JA_ENVIADA') {
      return { ok: false, code: 'JA_ENVIADA', message: 'Você já enviou a avaliação do seu líder neste ciclo. Obrigado!' };
    }
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, code: 'ERRO', message: 'Erro inesperado. Tente novamente em instantes.' };
  }
}

// ------------------------------------------------------------------ banco de verdade (Postgres)

function repositorioPostgres(sql) {
  return {
    transacao: function (grava, fn) {
      return sql.begin(async function (t) {
        if (grava) await t`select pg_advisory_xact_lock(${TRAVA})`;
        return fn({
          ler: async function (hashes) {
            var r = await Promise.all([
              t`select mat, nome, cc, lider_mat, lider_nome, perfil, ativo, cpf_hash, atualizado_em from public.pessoas`,
              t`select id, form, ordem, texto, ativo from public.criterios`,
              t`select chave, valor from public.config`,
              t`select ciclo, form, avaliador, avaliador_nome, avaliado, avaliado_nome, data from public.participacao`,
              t`select id, ciclo, avaliado, avaliado_nome, avaliador, avaliador_nome, data, media, notas, porques, fortes, fracos, consideracoes
                from public.resp_lider`,
              t`select id, ciclo, lider, liderado, data, tipo, status, realizado_em, obs, atualizado_em from public.agenda`,
              t`select id, ciclo, tipo, avaliador, avaliador_nome, avaliado, avaliado_nome, data_feedback, data_reavaliacao, media, notas, obs,
                       fortes, fracos, plano, consideracoes, ciencia_em, enviado_em, atualizado_em from public.resp_liderado`,
              t`select nome, valor from public.segredos`,
              hashes.length
                ? t`select chave, valor, (extract(epoch from expira_em) * 1000)::bigint as exp from public.cache where chave in ${t(hashes)} and expira_em > now()`
                : Promise.resolve([])
            ]);
            return { pessoas: r[0], criterios: r[1], config: r[2], participacao: r[3], respostas: r[4], agenda: r[5], liderados: r[6], segredos: r[7], cache: r[8] };
          },
          gravar: async function (ops) {
            for (var i = 0; i < ops.length; i++) {
              var op = ops[i], d = op.dados;
              if (op.tipo === 'participacao') {
                var ins = await t`insert into public.participacao (ciclo, form, avaliador, avaliador_nome, avaliado, avaliado_nome, data)
                  values (${d.ciclo}, ${d.form}, ${d.avaliador}, ${d.avaliadorNome || ''}, ${d.avaliado || ''}, ${d.avaliadoNome || ''}, ${d.data || ''})
                  on conflict do nothing returning avaliador`;
                if (!ins.length) { var e = new Error('participação duplicada'); e.codigoFeedback = 'JA_ENVIADA'; throw e; }
              } else if (op.tipo === 'up') {
                await t`insert into public.resp_lider (id, ciclo, avaliado, avaliado_nome, avaliador, avaliador_nome, data, media, notas, porques,
                         fortes, fracos, consideracoes)
                  values (${d.id}, ${d.ciclo}, ${d.avaliado}, ${d.avaliadoNome || ''}, ${d.avaliador || ''}, ${d.avaliadorNome || ''}, ${d.data || ''},
                          ${d.media}, ${t.json(d.notas || {})}, ${t.json(d.porques || {})}, ${t.json(d.fortes || [])}, ${t.json(d.fracos || [])},
                          ${d.consideracoes || ''})`;
              } else if (op.tipo === 'down') {
                await t`insert into public.resp_liderado (id, ciclo, tipo, avaliador, avaliador_nome, avaliado, avaliado_nome, data_feedback,
                         data_reavaliacao, media, notas, obs, fortes, fracos, plano, consideracoes, ciencia_em, enviado_em, atualizado_em)
                  values (${d.id}, ${d.ciclo}, ${d.tipo || 'PADRAO'}, ${d.avaliador}, ${d.avaliadorNome || ''}, ${d.avaliado}, ${d.avaliadoNome || ''},
                          ${d.dataFeedback || ''}, ${d.dataReavaliacao || ''}, ${d.media}, ${t.json(d.notas || {})}, ${t.json(d.obs || {})},
                          ${t.json(d.fortes || [])}, ${t.json(d.fracos || [])}, ${t.json(d.plano || [])}, ${d.consideracoes || ''},
                          ${d.cienciaEm || ''}, ${d.enviadoEm || ''}, ${d.atualizadoEm || ''})
                  on conflict (id) do update set tipo = excluded.tipo, data_feedback = excluded.data_feedback, data_reavaliacao = excluded.data_reavaliacao,
                    media = excluded.media, notas = excluded.notas, obs = excluded.obs, fortes = excluded.fortes, fracos = excluded.fracos,
                    plano = excluded.plano, consideracoes = excluded.consideracoes, ciencia_em = excluded.ciencia_em,
                    avaliador_nome = excluded.avaliador_nome, avaliado_nome = excluded.avaliado_nome, atualizado_em = excluded.atualizado_em`;
              } else if (op.tipo === 'agenda') {
                await t`insert into public.agenda (id, ciclo, lider, liderado, data, tipo, status, realizado_em, obs, atualizado_em)
                  values (${d.id}, ${d.ciclo}, ${d.lider}, ${d.liderado}, ${d.data}, ${d.tipo}, ${d.status}, ${d.realizadoEm || ''}, ${d.obs || ''},
                          ${d.atualizadoEm || ''})
                  on conflict (id) do update set data = excluded.data, tipo = excluded.tipo, status = excluded.status,
                    realizado_em = excluded.realizado_em, obs = excluded.obs, atualizado_em = excluded.atualizado_em`;
              } else if (op.tipo === 'pessoa') {
                await t`insert into public.pessoas ${t(linhaPessoa(d))}
                  on conflict (mat) do update set nome = excluded.nome, cc = excluded.cc, lider_mat = excluded.lider_mat, lider_nome = excluded.lider_nome,
                    perfil = excluded.perfil, ativo = excluded.ativo, cpf_hash = excluded.cpf_hash, atualizado_em = excluded.atualizado_em`;
              } else if (op.tipo === 'pessoas') {
                await t`delete from public.pessoas`;
                for (var j = 0; j < d.length; j += 500) await t`insert into public.pessoas ${t(d.slice(j, j + 500).map(linhaPessoa))}`;
              } else if (op.tipo === 'criterios') {
                await t`delete from public.criterios`;
                if (d.length) {
                  await t`insert into public.criterios ${t(d.map(function (c) {
                    return { id: c.id, form: c.form, ordem: Number(c.ordem) || 0, texto: c.texto, ativo: c.ativo !== false };
                  }))}`;
                }
              } else if (op.tipo === 'config') {
                var chavesCfg = Object.keys(d);
                for (var k = 0; k < chavesCfg.length; k++) {
                  await t`insert into public.config (chave, valor) values (${chavesCfg[k]}, ${t.json(d[chavesCfg[k]])})
                    on conflict (chave) do update set valor = excluded.valor`;
                }
              } else if (op.tipo === 'log') {
                await t`insert into public.log (mat, evento, detalhe) values (${d.mat}, ${d.evento}, ${d.detalhe})`;
              } else if (op.tipo === 'cachePut') {
                await t`insert into public.cache (chave, valor, expira_em) values (${hashChave(op.chave)}, ${op.valor}, now() + make_interval(secs => ${op.seg}::double precision))
                  on conflict (chave) do update set valor = excluded.valor, expira_em = excluded.expira_em`;
              } else if (op.tipo === 'cacheDel') {
                await t`delete from public.cache where chave = ${hashChave(op.chave)}`;
              }
            }
            if (ops.length && Math.random() < 0.1) await t`delete from public.cache where expira_em < now()`;
          }
        });
      });
    }
  };
}

function respostaJson(obj, status) {
  var h = { 'Content-Type': 'application/json; charset=utf-8' };
  Object.keys(CORS).forEach(function (k) { h[k] = CORS[k]; });
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

var conexao = null;
function banco() {
  if (!conexao) conexao = postgres(Deno.env.get('SUPABASE_DB_URL'), { prepare: false, max: 4, idle_timeout: 20, connect_timeout: 15 });
  return conexao;
}

// Atende cada pedido. Quem liga ao Deno.serve é o arquivo de entrada (supabase/functions/feedback/index.ts).
async function tratarPedido(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET') {
    // verificação de saúde (também serve para manter o projeto ativo)
    try {
      var r = await banco()`select count(*)::int as n from public.config`;
      return respostaJson({ ok: true, servico: 'feedback-semestral', config: r[0].n });
    } catch (e) {
      console.error(e);
      return respostaJson({ ok: false, code: 'BANCO' }, 503);
    }
  }
  if (req.method !== 'POST') return respostaJson({ ok: false, code: 'METODO', message: 'Use POST.' }, 405);
  var corpo;
  try {
    var texto = await req.text();
    if (texto.length > 3000000) throw new Error('pedido grande demais');
    corpo = JSON.parse(texto || '{}') || {};
  } catch (e) {
    return respostaJson({ ok: false, code: 'VALIDACAO', message: 'Pedido inválido.' });
  }
  return respostaJson(await executarPedido(repositorioPostgres(banco()), corpo));
}

export function iniciar(biblioteca) { postgres = biblioteca; return tratarPedido; }
