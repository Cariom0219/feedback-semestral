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

  /** O feedback do líder só pode ser registrado depois que o liderado respondeu a avaliação do líder no ciclo. */
  function respondeuLider(store, ciclo, mat) {
    return store.listParticipacao(ciclo).some(function (x) { return x.form === FORM_UP && x.avaliador === mat; });
  }

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
        prontos: equipe.filter(function (p) { return !!resp[p.mat] && !downs.some(function (r) { return r.avaliador === eu.mat && r.avaliado === p.mat; }); }).length,
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
      respondeu: respondeuLider(store, cfg.ciclo, p.mat),
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
    if (!respondeuLider(store, cfg.ciclo, p.mat)) {
      throw erro('AGUARDANDO_RESPOSTA', 'O feedback de ' + titulo(p.nome) + ' só pode ser registrado depois que essa pessoa responder a avaliação do líder neste ciclo.');
    }
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
      var resp = {};
      store.listParticipacao(cfg.ciclo).forEach(function (x) { if (x.form === FORM_UP) resp[x.avaliador] = true; });
      // quem já respondeu a avaliação do líder ganha as primeiras datas (só essas pessoas podem receber o feedback agora)
      equipe.slice().sort(function (a, b) {
        return (resp[b.mat] ? 1 : 0) - (resp[a.mat] ? 1 : 0) || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0);
      }).forEach(function (p) {
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

if (typeof module !== 'undefined' && module.exports) module.exports = FeedbackCore;
