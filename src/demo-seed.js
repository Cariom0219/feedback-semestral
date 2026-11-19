/* Demonstração: dados 100% fictícios e um "servidor" que roda no próprio navegador. */
window.FB_DEMO = true;
(function () {
  'use strict';
  var CHAVE = 'fbs_demo_v3';
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
  var LIDERES = { '9001': true, '9101': true, '9102': true, '9103': true };

  // Perfil de cada líder: média esperada por item (o resto fica em torno da média base).
  var PERFIL_LIDER = {
    '9101': { base: 4.0, LL01: 4.6, LL08: 4.6, LL12: 4.5, LL06: 3.1, LL07: 2.9, LL11: 3.4 },
    '9102': { base: 4.1, LL02: 4.7, LL03: 4.6, LL11: 4.6, LL04: 3.2, LL09: 3.5 },
    '9103': { base: 3.6, LL01: 2.8, LL13: 3.0, LL08: 4.4, LL05: 3.1 },
    '9001': { base: 4.2, LL04: 3.5, LL09: 3.4, LL13: 4.7, LL03: 4.5 }
  };
  var PORQUE = {
    LL01: 'As orientações chegam só pelo grupo, sem detalhe do serviço.',
    LL02: 'Já chamou a atenção de colega na frente de todo mundo.',
    LL03: 'Quando a equipe sugere alguma coisa, não tem retorno.',
    LL04: 'As rotas mudam em cima da hora e a equipe perde tempo.',
    LL05: 'Não tive nenhuma conversa sobre o que posso melhorar.',
    LL06: 'Quando a meta é batida, ninguém comenta.',
    LL07: 'Briga entre colegas ficou semanas sem solução.',
    LL08: 'Já liberou serviço sem conferir o EPI.',
    LL09: 'Em campo, demora para atender o telefone.',
    LL10: 'Não indica cursos nem dá chance de aprender outras atividades.',
    LL11: 'Tenho receio de falar quando algo não está bem.',
    LL12: 'Pouco acompanhamento em campo nos procedimentos.',
    LL13: 'As informações sobre metas chegam pela metade.',
    LD01: 'Saiu antes do fim do serviço em duas ocasiões.',
    LD02: 'Três atrasos na saída da base neste mês.',
    LD03: 'Deixou de registrar ocorrência no sistema.',
    LD04: 'Retrabalho em leituras com foto ilegível.',
    LD05: 'A rota terminou incompleta várias vezes.',
    LD06: 'Evita ajudar os colegas quando termina antes.',
    LD07: 'Não avisa quando tem problema em campo.',
    LD08: 'Precisa aprender a usar o novo aplicativo de leitura.',
    LD09: 'Não seguiu o procedimento padrão de corte.',
    LD10: 'Foi visto em campo sem a luva isolante.'
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
  var FORTES_COORD = ['Conhece a operação de perto', 'Decide com base em dados', 'Está disponível para os supervisores', 'Transparência nas metas',
    'Apoia a equipe nas dificuldades', 'Organização das prioridades', 'Cobra segurança com exemplo'];
  var FRACOS_COORD = ['Reuniões longas', 'Muitas demandas ao mesmo tempo', 'Retorno às vezes demora', 'Pouca presença em Itaberaba',
    'Prazos muito apertados', 'Mensagens fora do horário', 'Delegar mais'];
  var FORTES_SUP = ['Cobra segurança com exemplo', 'Equipe unida', 'Bom controle das rotas', 'Resolve problemas em campo', 'Relatórios em dia', 'Boa relação com a equipe'];
  var FRACOS_SUP = ['Delegar mais', 'Retorno à equipe demora', 'Pouca conversa individual', 'Organização das rotas', 'Registro de ocorrências', 'Planejamento semanal'];
  var PLANOS = ['Chegar à base 10 minutos antes da saída', 'Revisar as fotos antes de finalizar cada leitura', 'Fazer o check-list de EPI todos os dias',
    'Avisar o supervisor sempre que houver impedimento em campo', 'Fazer o treinamento do novo aplicativo'];
  var PLANOS_LIDER = ['Fazer uma conversa individual por mês com cada liderado', 'Elogiar em público as entregas da equipe',
    'Resolver conflitos da equipe em até 1 semana', 'Divulgar as metas da semana toda segunda-feira'];
  var FORTES_ADM = ['Organização', 'Relatórios em dia', 'Boa comunicação com as equipes', 'Cumpre os prazos', 'Proatividade', 'Conhece os processos'];
  var FRACOS_ADM = ['Retorno às solicitações demora', 'Planejamento semanal', 'Delegar mais', 'Pouca presença nas bases', 'Atualização das planilhas'];
  var PLANOS_ADM = ['Fechar os relatórios do mês até o dia 5', 'Responder as solicitações das equipes em até 1 dia', 'Visitar as bases uma vez por mês'];
  var CONSIDERACOES = ['Conversa feita na base. Combinamos acompanhar os pontos do plano no próximo mês.',
    'Bom semestre. Continue assim e ajude os colegas novos.', 'Evoluiu bastante desde o último feedback.', ''];

  function prng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function semana(iso) { var p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function util(iso, passo) { while (semana(iso) === 0 || semana(iso) === 6) iso = Core.somarDias(iso, passo); return iso; }

  function montar() {
    var gravar = false;
    var store = MemoryStore(null, { persistir: function (st) { if (gravar) persistir(st); } });
    var HOJE = store.hoje();
    var dia = function (n) { return util(Core.somarDias(HOJE, n), n < 0 ? -1 : 1); };
    var rnd = prng(20261118);
    var crit = Core.CRITERIOS_PADRAO;
    store.salvarCriterios(crit);
    store.setConfig({ ciclo: '2026-2', faseLideradoLider: 'ABERTA', faseLiderLiderado: 'ABERTA', ciclosLiberados: ['2026-1'], organizacao: Core.CONFIG_PADRAO.organizacao });
    var pessoas = BASE.map(function (l) {
      return { mat: l[0], nome: l[1], cc: l[2], liderMat: '', liderNome: l[3], perfil: l[4], ativo: true, cpfHash: Core.hashCpf(store, l[0], cpfDe(l[0])), atualizadoEm: '2026-11-03T08:00:00' };
    });
    var porNome = {}, porMat = {};
    pessoas.forEach(function (p) { porNome[p.nome] = p; porMat[p.mat] = p; });
    pessoas.forEach(function (p) { if (p.liderNome) p.liderMat = porNome[p.liderNome].mat; });
    store.substituirPessoas(pessoas);

    function nota(m) { return Math.max(1, Math.min(5, Math.round(m + (rnd() - 0.5) * 1.8))); }
    function media(n) { var k = Object.keys(n); return Math.round(k.reduce(function (a, x) { return a + n[x]; }, 0) / k.length * 100) / 100; }
    function escolher(lista, k) {
      var c = lista.slice(), out = [];
      while (out.length < k && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
      return out;
    }
    function porques(n) {
      var o = {};
      Object.keys(n).forEach(function (id) { if (n[id] <= 2 || (n[id] === 3 && rnd() < 0.25)) o[id] = PORQUE[id]; });
      return o;
    }
    function agendar(ciclo, lider, liderado, data, tipo, status) {
      store.salvarAgenda({
        id: store.uuid(), ciclo: ciclo, lider: lider, liderado: liderado, data: data, tipo: tipo || 'FEEDBACK', status: status || 'AGENDADO',
        realizadoEm: status === 'REALIZADO' ? data : '', obs: '', atualizadoEm: data + 'T09:00:00'
      });
    }

    function responder(ciclo, p, data, deslocamento) {
      var lider = porMat[p.liderMat];
      var coord = lider.perfil === 'COORDENACAO';
      var perfil = PERFIL_LIDER[lider.mat], n = {};
      crit.filter(function (c) { return c.form === Core.FORM_UP; }).forEach(function (c) { n[c.id] = nota((perfil[c.id] || perfil.base) + (deslocamento || 0)); });
      store.addUp({
        id: store.uuid(), ciclo: ciclo, avaliado: lider.mat, avaliadoNome: lider.nome, avaliador: p.mat, avaliadorNome: p.nome, data: data,
        notas: n, porques: porques(n), media: media(n),
        fortes: coord ? escolher(FORTES_COORD, 3) : [], fracos: coord ? escolher(FRACOS_COORD, 3) : [],
        consideracoes: rnd() < 0.55 ? COMENTARIOS[Math.floor(rnd() * COMENTARIOS.length)] : ''
      });
      store.addParticipacao({ ciclo: ciclo, form: Core.FORM_UP, avaliador: p.mat, avaliadorNome: p.nome, avaliado: lider.mat, avaliadoNome: lider.nome, data: data });
    }

    function avaliar(ciclo, p, dataF, op) {
      op = op || {};
      var lider = porMat[p.liderMat];
      var temEquipe = !!LIDERES[p.mat];
      var lid = temEquipe || lider.perfil === 'COORDENACAO'; // quem responde direto à coordenação é avaliado como líder
      var n = {}, base = op.base || 3.3 + rnd() * 1.4;
      crit.filter(function (c) { return c.form === (lid ? Core.FORM_UP : Core.FORM_DOWN) && c.ativo !== false; }).forEach(function (c) { n[c.id] = nota(base); });
      Object.keys(op.forcar || {}).forEach(function (k) { n[k] = op.forcar[k]; });
      var baixos = Object.keys(n).filter(function (k) { return n[k] <= 3; }).length;
      store.saveDown({
        id: store.uuid(), ciclo: ciclo, tipo: lid ? 'LIDERANCA' : 'PADRAO', avaliador: lider.mat, avaliadorNome: lider.nome, avaliado: p.mat, avaliadoNome: p.nome,
        dataFeedback: dataF, dataReavaliacao: Core.somarMeses(dataF, 3), notas: n, media: media(n), obs: porques(n),
        fortes: lid ? escolher(temEquipe ? FORTES_SUP : FORTES_ADM, 3) : [], fracos: lid ? escolher(temEquipe ? FRACOS_SUP : FRACOS_ADM, 3) : [],
        plano: baixos ? escolher(temEquipe ? PLANOS_LIDER : lid ? PLANOS_ADM : PLANOS, Math.min(2, baixos)) : [],
        consideracoes: op.consideracoes !== undefined ? op.consideracoes : CONSIDERACOES[Math.floor(rnd() * CONSIDERACOES.length)],
        cienciaEm: op.ciencia ? dataF + 'T17:30:00' : '', enviadoEm: dataF + 'T10:00:00', atualizadoEm: dataF + 'T10:00:00'
      });
      agendar(ciclo, lider.mat, p.mat, dataF, 'FEEDBACK', 'REALIZADO');
    }

    var liderados = pessoas.filter(function (p) { return p.liderMat; });

    // Ciclo anterior (2026-1): encerrado e liberado.
    liderados.forEach(function (p, i) {
      if (rnd() < 0.86 || p.liderMat === '9001') responder('2026-1', p, '2026-05-' + ('0' + (5 + (i % 20))).slice(-2), -0.25);
      avaliar('2026-1', p, '2026-06-' + ('0' + (2 + (i % 24))).slice(-2), { ciencia: rnd() < 0.8, base: 3.1 + rnd() * 1.4 });
    });

    // Ciclo atual (2026-2): a equipe está avaliando os líderes e os líderes estão dando feedback.
    // O feedback do líder só pode ser dado a quem já respondeu a avaliação do líder.
    var responderam = {
      '9101': ['1002', '1003', '1004', '1005', '1006', '1007', '1008', '1010', '1011', '1012'], '9102': ['1014', '1015', '1018', '1021'],
      '9103': ['1023', '1024', '1025', '1027', '1028', '1030'], '9001': ['9002', '9103']
    };
    var k = 0;
    Object.keys(responderam).forEach(function (l) {
      responderam[l].forEach(function (mat) { responder('2026-2', porMat[mat], dia(-12 + (k++ % 10)), 0); });
    });
    // Coordenação: feedback do Rogério já feito; os demais marcados (um atrasado, de quem ainda não respondeu).
    avaliar('2026-2', porMat['9103'], dia(-6), { base: 3.9, ciencia: true, consideracoes: 'Equipe com bons números de segurança. Combinamos dar mais retorno individual aos leituristas.' });
    agendar('2026-2', '9001', '9003', dia(-2));
    agendar('2026-2', '9001', '9101', dia(2));
    agendar('2026-2', '9001', '9102', dia(3));
    agendar('2026-2', '9001', '9002', dia(5));
    // Edson (9101)
    avaliar('2026-2', porMat['1004'], dia(-8), { ciencia: true });
    avaliar('2026-2', porMat['1007'], dia(-7), { base: 3.5, forcar: { LD02: 2 }, ciencia: true });
    avaliar('2026-2', porMat['1011'], dia(-2), { base: 4.3, consideracoes: 'Marcelo é referência de qualidade na equipe. Combinamos que ele vai acompanhar os dois leituristas novos nas primeiras rotas.' });
    var d1007 = store.listDown('2026-2').filter(function (r) { return r.avaliado === '1007'; })[0].dataFeedback;
    [1, 2, 3].forEach(function (m) { agendar('2026-2', '9101', '1007', util(Core.somarMeses(d1007, m), 1), 'ACOMPANHAMENTO'); });
    agendar('2026-2', '9101', '1001', dia(2));
    agendar('2026-2', '9101', '1002', dia(1));
    agendar('2026-2', '9101', '1003', dia(1));
    agendar('2026-2', '9101', '1005', dia(3));
    agendar('2026-2', '9101', '1006', dia(3));
    agendar('2026-2', '9101', '1008', dia(-3));
    // Patrícia (9102)
    avaliar('2026-2', porMat['1014'], dia(-4), { base: 2.9 });
    avaliar('2026-2', porMat['1015'], dia(-4), { base: 4.0, ciencia: true });
    agendar('2026-2', '9102', '1013', dia(2));
    agendar('2026-2', '9102', '1016', dia(4));
    agendar('2026-2', '9102', '1017', dia(4));
    agendar('2026-2', '9102', '1018', dia(9));

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
    { perfil: 'Colaborador com feedback', nome: 'Marcelo Dias Fonseca', mat: '1011', cpf: cpfDe('1011') },
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
