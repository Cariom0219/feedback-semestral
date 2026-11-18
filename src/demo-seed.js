/* Demonstração: dados 100% fictícios e um "servidor" que roda no próprio navegador. */
window.FB_DEMO = true;
(function () {
  'use strict';
  var CHAVE = 'fbs_demo_v1';
  var Core = window.FeedbackCore;

  function cpf(base) {
    var d = String(base).slice(0, 9).split('').map(Number);
    for (var t = 9; t < 11; t++) {
      var s = 0;
      for (var i = 0; i < t; i++) s += d[i] * (t + 1 - i);
      d.push(((s * 10) % 11) % 10);
    }
    var x = d.join('');
    return x.slice(0, 3) + '.' + x.slice(3, 6) + '.' + x.slice(6, 9) + '-' + x.slice(9);
  }
  function cpfDe(mat) { return cpf(300000000 + Number(mat) * 1013); }

  var COORD = 'MARCOS VINICIUS TELES';
  var EDSON = 'EDSON CARVALHO REIS', PATRICIA = 'PATRICIA NOGUEIRA LIMA', ROGERIO = 'ROGERIO BATISTA FREITAS';
  var BASE = [
    ['9001', COORD, 'COORDENACAO CENTRO-BA', '', 'COORDENACAO'],
    ['9002', 'LUANA PRADO MATOS', 'IRE ADM LOCAL REH', COORD, 'RH'],
    ['9003', 'HELENA CASTRO DUARTE', 'ITA ADM LOCAL', COORD, 'COLABORADOR'],
    ['9101', EDSON, 'IRE LET', COORD, 'COLABORADOR'],
    ['9102', PATRICIA, 'ITA ADM LOCAL STC', COORD, 'COLABORADOR'],
    ['9103', ROGERIO, 'IRE ADM LOCAL STC', COORD, 'COLABORADOR']
  ];
  var GRUPOS = [
    [['ANA BEATRIZ MOURA', 'BRUNO FERREIRA SALES', 'CARLOS EDUARDO NUNES', 'DANIELA ROCHA PIRES', 'EVERTON LUIS MACEDO', 'FABIO JUNIOR TAVARES',
      'GILSON ARAUJO PRADO', 'IGOR SANTANA LOPES', 'JOAO VITOR BRANDAO', 'LEANDRO COSTA VIANA', 'MARCELO DIAS FONSECA', 'NATALIA REIS AMORIM'], EDSON, 'IRE LET GPB'],
    [['OTAVIO MENDES CRUZ', 'PAULO HENRIQUE SODRE', 'RAFAEL LIMA BASTOS', 'SAMUEL OLIVEIRA ROCHA', 'TATIANE GOMES LEAL', 'ULISSES RAMOS VIEIRA',
      'VALDIR SOUZA PINTO', 'WAGNER ALVES CORREIA', 'YASMIN FARIAS COUTO', 'ZECA MOREIRA PAIVA'], PATRICIA, 'ITA STC'],
    [['ADRIANO FREITAS BOMFIM', 'CLEBER SANTOS MOTA', 'DENIS PEREIRA LUZ', 'EDUARDO SILVA NERY', 'FLAVIA CUNHA BARROS', 'GEOVANE MATOS LIRA',
      'HUGO NASCIMENTO REGO', 'IVAN TEIXEIRA DORIA'], ROGERIO, 'IRE STC']
  ];
  var proxMat = 1001;
  GRUPOS.forEach(function (g) {
    g[0].forEach(function (nome) { BASE.push([String(proxMat++), nome, g[2], g[1], 'COLABORADOR']); });
  });

  // Perfis de cada líder: média esperada por item (o resto fica em torno da média base).
  var PERFIL_LIDER = {
    '9101': { base: 4.0, LL01: 4.6, LL08: 4.6, LL12: 4.5, LL06: 3.1, LL07: 2.9, LL11: 3.4 },
    '9102': { base: 4.1, LL02: 4.7, LL03: 4.6, LL11: 4.6, LL04: 3.2, LL09: 3.5 },
    '9103': { base: 3.6, LL01: 2.8, LL13: 3.0, LL08: 4.4, LL05: 3.1 },
    '9001': { base: 4.2, LL04: 3.5, LL09: 3.4, LL13: 4.7, LL03: 4.5 }
  };
  var COMENTARIOS = [
    'Sempre explica o serviço do dia com clareza antes de a equipe sair para o campo.',
    'Poderia reconhecer mais quando a equipe bate a meta. Um elogio na frente de todos faz diferença.',
    'Quando tem conflito na equipe, demora para resolver e o clima pesa.',
    'Cobra o uso de EPI todos os dias. Isso passa segurança.',
    'Gostaria de ter mais retorno sobre o meu desempenho durante o mês, não só no fechamento.',
    'É justo na divisão das rotas e não tem preferido.',
    'Às vezes passa as orientações muito em cima da hora.',
    'Escuta a equipe e aceita sugestões de melhoria.',
    'Falta conversa individual. Muita coisa fica só no grupo.',
    'Está sempre disponível no telefone quando a gente precisa em campo.'
  ];
  var FORTES = ['Conhece a operação de perto', 'Decide com base em dados', 'Está disponível para os supervisores', 'Transparência nas metas',
    'Apoia a equipe nas dificuldades', 'Organização das prioridades', 'Cobra segurança com exemplo'];
  var FRACOS = ['Reuniões longas', 'Muitas demandas ao mesmo tempo', 'Retorno às vezes demora', 'Pouca presença em Itaberaba',
    'Prazos muito apertados', 'Mensagens fora do horário', 'Delegar mais'];

  function prng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function montar() {
    var gravar = false;
    var store = MemoryStore(null, { persistir: function (st) { if (gravar) persistir(st); } });
    var rnd = prng(20261118);
    var crit = Core.CRITERIOS_PADRAO;
    store.salvarCriterios(crit);
    store.setConfig({ ciclo: '2026-2', faseLideradoLider: 'ABERTA', faseLiderLiderado: 'ABERTA', ciclosLiberados: ['2026-1'], minimoRespostas: 3, organizacao: Core.CONFIG_PADRAO.organizacao });
    var pessoas = BASE.map(function (l) {
      return { mat: l[0], nome: l[1], cc: l[2], liderMat: '', liderNome: l[3], perfil: l[4], ativo: true, cpfHash: Core.hashCpf(store, l[0], cpfDe(l[0])), atualizadoEm: '2026-11-03T08:00:00' };
    });
    var porNome = {};
    pessoas.forEach(function (p) { porNome[p.nome] = p; });
    pessoas.forEach(function (p) { if (p.liderNome) p.liderMat = porNome[p.liderNome].mat; });
    store.substituirPessoas(pessoas);

    function nota(media) { return Math.max(1, Math.min(5, Math.round(media + (rnd() - 0.5) * 1.8))); }
    function notasLider(liderMat, deslocamento) {
      var perfil = PERFIL_LIDER[liderMat], n = {};
      crit.filter(function (c) { return c.form === Core.FORM_UP; }).forEach(function (c) { n[c.id] = nota((perfil[c.id] || perfil.base) + (deslocamento || 0)); });
      return n;
    }
    function media(n) { var k = Object.keys(n); return Math.round(k.reduce(function (a, x) { return a + n[x]; }, 0) / k.length * 100) / 100; }
    function escolher(lista, k) {
      var c = lista.slice(), out = [];
      while (out.length < k && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
      return out;
    }
    function dia(ano, mes, d) { return ano + '-' + ('0' + mes).slice(-2) + '-' + ('0' + d).slice(-2); }

    function responder(ciclo, p, data, deslocamento) {
      var lider = pessoas.filter(function (x) { return x.mat === p.liderMat; })[0];
      var coord = lider.perfil === 'COORDENACAO';
      var n = notasLider(lider.mat, deslocamento);
      store.addUp({
        id: store.uuid(), ciclo: ciclo, avaliado: lider.mat, avaliadoNome: lider.nome, notas: n, media: media(n),
        fortes: coord ? escolher(FORTES, 3) : [], fracos: coord ? escolher(FRACOS, 3) : [],
        consideracoes: rnd() < 0.55 ? COMENTARIOS[Math.floor(rnd() * COMENTARIOS.length)] : ''
      });
      store.addParticipacao({ ciclo: ciclo, form: Core.FORM_UP, avaliador: p.mat, avaliadorNome: p.nome, avaliado: lider.mat, avaliadoNome: lider.nome, data: data });
    }
    function avaliarLiderado(ciclo, p, dataF, dataR) {
      var lider = pessoas.filter(function (x) { return x.mat === p.liderMat; })[0];
      var n = {}, base = 3.3 + rnd() * 1.4;
      crit.filter(function (c) { return c.form === Core.FORM_DOWN; }).forEach(function (c) { n[c.id] = nota(base); });
      var obs = {};
      if (n.LD02 <= 3) obs.LD02 = 'Combinar horário de saída da base.';
      if (n.LD10 <= 3) obs.LD10 = 'Reforçar check-list de EPI antes de cada serviço.';
      store.saveDown({
        id: store.uuid(), ciclo: ciclo, avaliador: lider.mat, avaliadorNome: lider.nome, avaliado: p.mat, avaliadoNome: p.nome,
        dataFeedback: dataF, dataReavaliacao: dataR, notas: n, media: media(n), obs: obs,
        consideracoes: rnd() < 0.5 ? 'Conversa feita na base. Combinamos acompanhamento no próximo mês.' : '',
        enviadoEm: dataF + 'T10:00:00', atualizadoEm: dataF + 'T10:00:00'
      });
    }

    var liderados = pessoas.filter(function (p) { return p.liderMat; });
    // Ciclo anterior (2026-1): encerrado e liberado.
    liderados.forEach(function (p, i) {
      if (rnd() < 0.86 || p.liderMat === '9001') responder('2026-1', p, dia(2026, 5, 5 + (i % 20)), -0.25);
      avaliarLiderado('2026-1', p, dia(2026, 6, 2 + (i % 24)), dia(2026, 9, 2 + (i % 24)));
    });
    // Ciclo atual (2026-2): avaliação do líder em andamento.
    var atual = { '9101': ['1002', '1003', '1005', '1006', '1008', '1010', '1012'], '9102': ['1014', '1015', '1018', '1021'],
      '9103': ['1023', '1024', '1025', '1027', '1028', '1030'], '9001': ['9002', '9103'] };
    var k = 0;
    Object.keys(atual).forEach(function (l) {
      atual[l].forEach(function (mat) {
        var p = pessoas.filter(function (x) { return x.mat === mat; })[0];
        responder('2026-2', p, dia(2026, 11, 3 + (k++ % 14)), 0);
      });
    });
    ['1004', '1007', '1011'].forEach(function (mat, i) {
      avaliarLiderado('2026-2', pessoas.filter(function (x) { return x.mat === mat; })[0], dia(2026, 11, 10 + i), dia(2027, 2, 10 + i));
    });
    gravar = true;
    persistir(store._estado());
    return store;
  }

  function persistir(estado) { try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) { /* sem armazenamento local */ } }
  function carregarSalvo() {
    try { var s = localStorage.getItem(CHAVE); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  var salvo = carregarSalvo();
  var store = salvo ? MemoryStore(salvo, { persistir: persistir }) : montar();

  window.FB_DEMO_RESET = function () {
    try { localStorage.removeItem(CHAVE); } catch (e) { /* nada */ }
    store = montar();
  };
  window.FB_DEMO_ACESSOS = [
    { perfil: 'Colaborador', nome: 'Ana Beatriz Moura', mat: '1001', cpf: cpfDe('1001') },
    { perfil: 'Supervisor', nome: 'Edson Carvalho Reis', mat: '9101', cpf: cpfDe('9101') },
    { perfil: 'Coordenação', nome: 'Marcos Vinicius Teles', mat: '9001', cpf: cpfDe('9001') },
    { perfil: 'RH', nome: 'Luana Prado Matos', mat: '9002', cpf: cpfDe('9002') }
  ];

  function Runner(ok, falha) { this.ok = ok; this.falha = falha; }
  Runner.prototype.withSuccessHandler = function (f) { return new Runner(f, this.falha); };
  Runner.prototype.withFailureHandler = function (f) { return new Runner(this.ok, f); };
  Runner.prototype.api = function (acao, dadosJson, token) {
    var self = this;
    setTimeout(function () {
      var r;
      try { r = Core.handle(store, acao, JSON.parse(dadosJson || '{}'), token); } catch (e) { if (self.falha) self.falha(e); return; }
      if (self.ok) self.ok(JSON.stringify(r));
    }, 90 + Math.floor(Math.random() * 160));
  };
  window.google = { script: { run: new Runner(null, null) } };
})();
