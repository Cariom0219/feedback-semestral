const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Core = require('../src/core.js');
const { MemoryStore, Sha256 } = require('../src/store-memory.js');

function cpfCom(base9) {
  const d = String(base9).padStart(9, '0').split('').map(Number);
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i);
    d.push(((s * 10) % 11) % 10);
  }
  const x = d.join('');
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
}

function relogio(inicio) {
  let t = new Date(inicio).getTime();
  const f = () => new Date(t);
  f.avancar = (ms) => { t += ms; };
  return f;
}

const CPF = {};
function montar() {
  const clock = relogio('2026-11-18T12:00:00Z');
  const store = MemoryStore(null, { relogio: clock });
  const linhas = [['Matricula', 'Descrição C.C', 'Liderança', 'Nome complet', 'C.P.F.']];
  const add = (mat, cc, lider, nome) => {
    CPF[mat] = cpfCom(100000000 + Number(mat));
    linhas.push([mat, cc, lider, nome, CPF[mat]]);
  };
  add(100, 'IRE LET', 'JOSE DELTA DE SA SOUZA', 'SUPERVISOR UM DA SILVA');
  add(200, 'ITA ADM LOCAL STC', 'JOSE DELTA DE SA SOUZA', 'SUPERVISORA DOIS SANTOS');
  add(901, 'IRE ADM LOCAL REH', 'JOSE DELTA DE SA SOUZA', 'ANALISTA RH SOUZA');
  for (let i = 1; i <= 6; i++) add(100 + i, 'IRE LET GPB', 'SUPERVISOR UM DA SILVA', `COLABORADOR ${i} DE OLIVEIRA`);
  add(201, 'ITA STC', 'SUPERVISORA DOIS SANTOS', 'COLABORADORA SETE LIMA');
  add(202, 'ITA STC', 'SUPERVISORA DOIS SANTOS', 'COLABORADOR OITO PEREIRA');
  const r = Core.importar(store, linhas, {}, 'teste');
  // coordenador fora da base, cadastrado à parte (como no menu da planilha)
  CPF[900] = cpfCom(100000900);
  store.salvarPessoa({ mat: '900', nome: 'JOSÉ DELTA DE SÁ SOUZA', cc: 'COORDENACAO', liderMat: '', liderNome: '', perfil: 'COORDENACAO', ativo: true, cpfHash: Core.hashCpf(store, '900', CPF[900]), atualizadoEm: '' });
  // RH
  const rh = store.listPessoas().find((p) => p.mat === '901');
  rh.perfil = 'RH';
  store.salvarPessoa(rh);
  return { store, clock, importacao: r };
}

function entrar(store, mat) {
  const r = Core.handle(store, 'login', { mat, cpf: CPF[mat] });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.token;
}
const api = (store, token, acao, dados) => Core.handle(store, acao, dados || {}, token);
const notas = (prefixo, n, v) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefixo}${String(i + 1).padStart(2, '0')}`, typeof v === 'function' ? v(i) : v]));

test('sha256 confere com o Node', () => {
  for (const s of ['', 'abc', 'Irecê|5|52998224725', 'x'.repeat(200), 'ç😀']) {
    assert.equal(Sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('utilitários', () => {
  assert.equal(Core.nomeMascarado('ANTONIO ALVES DE SOUZA'), 'Antonio A. de Souza');
  assert.equal(Core.titulo('MARIA DAS DORES DE JESUS'), 'Maria das Dores de Jesus');
  assert.equal(Core.utdDoCC('FTVOLT IRE'), 'Irecê');
  assert.equal(Core.utdDoCC('ITA ADM LOCAL STC'), 'Itaberaba');
  assert.equal(Core.normMat(' 0005 '), '5');
  assert.equal(Core.cpfValido('529.982.247-25'), true);
  assert.equal(Core.cpfValido('529.982.247-24'), false);
  assert.equal(Core.cpfValido('111.111.111-11'), false);
  const m = Core.mapearCabecalho(['Matricula', 'Descrição C.C', 'Liderança', 'Nome complet', 'C.P.F.']);
  assert.deepEqual(m, { mat: 0, cc: 1, lider: 2, nome: 3, cpf: 4 });
});

test('importação liga liderados ao líder pelo nome, inclusive com acento', () => {
  const { store, importacao } = montar();
  assert.equal(importacao.novos, 11);
  const coord = importacao.lideres.find((l) => l.nome.startsWith('Jose Delta'));
  assert.equal(coord.encontrado, false, 'antes do cadastro do coordenador o líder fica pendente');
  const s = MemoryStore(store._estado());
  const t = entrar(s, '100');
  const h = api(s, t, 'home');
  assert.equal(h.data.meuLider.nome, 'José Delta de Sá Souza');
  assert.equal(h.data.meuLider.coordenacao, true);
});

test('lookup mascara o nome e trata matrícula inexistente', () => {
  const { store } = montar();
  const r = Core.handle(store, 'lookup', { mat: '0101' });
  assert.equal(r.ok, true);
  assert.equal(r.data.nome, 'Colaborador 1 de Oliveira');
  assert.equal(r.data.utd, 'Irecê');
  assert.equal(Core.handle(store, 'lookup', { mat: '777' }).code, 'NAO_ENCONTRADO');
});

test('login: CPF errado conta tentativas e bloqueia por 15 minutos', () => {
  const { store, clock } = montar();
  for (let i = 1; i <= 4; i++) {
    const r = Core.handle(store, 'login', { mat: '101', cpf: '000.000.000-00' });
    assert.equal(r.code, 'CPF_INVALIDO');
    assert.match(r.message, new RegExp(`${5 - i} tentativa`));
  }
  assert.equal(Core.handle(store, 'login', { mat: '101', cpf: '000.000.000-00' }).code, 'BLOQUEADO');
  assert.equal(Core.handle(store, 'login', { mat: '101', cpf: CPF[101] }).code, 'BLOQUEADO');
  clock.avancar(16 * 60 * 1000);
  const ok = Core.handle(store, 'login', { mat: '101', cpf: CPF[101] });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.home.eu.primeiroNome, 'Colaborador');
  assert.equal(ok.data.home.meuLider.nome, 'Supervisor Um da Silva');
});

test('sessão expira e ações exigem login', () => {
  const { store, clock } = montar();
  const t = entrar(store, '101');
  assert.equal(api(store, t, 'home').ok, true);
  assert.equal(api(store, 'x'.repeat(30), 'home').code, 'SESSAO');
  clock.avancar(5 * 3600 * 1000);
  assert.equal(api(store, t, 'home').code, 'SESSAO');
});

test('Liderado x Líder: validação, envio único e anonimato', () => {
  const { store } = montar();
  const t = entrar(store, '101');
  const f = api(store, t, 'formLider').data;
  assert.equal(f.criterios.length, 13);
  assert.equal(f.extras, false);
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 12, 4) }).code, 'INCOMPLETO');
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 13, 6) }).code, 'INCOMPLETO');
  const ok = api(store, t, 'enviarLider', { notas: notas('LL', 13, 4), consideracoes: '  Bom líder.  ' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 13, 4) }).code, 'JA_ENVIADA');
  const ups = store.listUp('2026-2');
  assert.equal(ups.length, 1);
  assert.equal(ups[0].consideracoes, 'Bom líder.');
  assert.equal(ups[0].avaliado, '100');
  for (const campo of ['avaliador', 'avaliadorNome', 'data', 'mat']) assert.equal(ups[0][campo], undefined, `resposta não pode ter ${campo}`);
  const part = store.listParticipacao('2026-2');
  assert.equal(part[0].avaliador, '101');
  assert.equal(api(store, t, 'home').data.avaliouLider, true);
});

test('avaliação do coordenador exige 3 pontos fortes e 3 fracos', () => {
  const { store } = montar();
  const t = entrar(store, '100');
  const f = api(store, t, 'formLider').data;
  assert.equal(f.extras, true);
  const base = { notas: notas('LL', 13, 5) };
  assert.equal(api(store, t, 'enviarLider', { ...base, fortes: ['a', 'b'], fracos: ['x', 'y', 'z'] }).code, 'INCOMPLETO');
  assert.equal(api(store, t, 'enviarLider', { ...base, fortes: ['a', 'b', 'c'], fracos: ['x', ' ', 'z'] }).code, 'INCOMPLETO');
  const ok = api(store, t, 'enviarLider', { ...base, fortes: ['Escuta', 'Organização', 'Presença'], fracos: ['Prazo', 'Feedback', 'Reuniões'], consideracoes: 'ok' });
  assert.equal(ok.ok, true);
  assert.deepEqual(store.listUp()[0].fortes, ['Escuta', 'Organização', 'Presença']);
});

test('fase fechada bloqueia envio', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  assert.equal(api(store, adm, 'salvarConfig', { faseLideradoLider: 'FECHADA' }).ok, true);
  const t = entrar(store, '102');
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 13, 3) }).code, 'FASE_FECHADA');
});

test('supervisor vê quem respondeu, mas não o que respondeu', () => {
  const { store } = montar();
  for (const m of ['101', '103']) api(store, entrar(store, m), 'enviarLider', { notas: notas('LL', 13, 4) });
  const t = entrar(store, '100');
  const eq = api(store, t, 'equipe').data;
  assert.equal(eq.pessoas.length, 6);
  const sim = eq.pessoas.filter((p) => p.respondeu).map((p) => p.mat).sort();
  assert.deepEqual(sim, ['101', '103']);
  assert.ok(eq.pessoas.every((p) => !('notas' in p) && !('respondeuEm' in p)));
  assert.equal(api(store, t, 'home').data.equipe.responderam, 2);
  const naoLider = entrar(store, '104');
  assert.equal(api(store, naoLider, 'equipe').code, 'PERMISSAO');
});

test('Líder x Liderado: só a própria equipe, fase aberta, datas válidas e edição', () => {
  const { store } = montar();
  const sup = entrar(store, '100');
  const dados = { mat: '101', notas: notas('LD', 10, 4), dataFeedback: '2026-11-18', dataReavaliacao: '2027-02-18', obs: { LD03: 'Melhorar registro' }, consideracoes: 'Segue evoluindo' };
  assert.equal(api(store, sup, 'salvarLiderado', dados).code, 'FASE_FECHADA');
  api(store, entrar(store, '900'), 'salvarConfig', { faseLiderLiderado: 'ABERTA' });
  assert.equal(api(store, sup, 'formLiderado', { mat: '201' }).code, 'PERMISSAO');
  assert.equal(api(store, sup, 'salvarLiderado', { ...dados, mat: '201' }).code, 'PERMISSAO');
  assert.equal(api(store, sup, 'salvarLiderado', { ...dados, dataFeedback: '' }).code, 'VALIDACAO');
  assert.equal(api(store, sup, 'salvarLiderado', { ...dados, dataReavaliacao: '2026-01-01' }).code, 'VALIDACAO');
  const r1 = api(store, sup, 'salvarLiderado', dados);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.data.media, 4);
  const r2 = api(store, sup, 'salvarLiderado', { ...dados, notas: notas('LD', 10, (i) => (i < 5 ? 5 : 3)) });
  assert.equal(r2.data.media, 4);
  const downs = store.listDown('2026-2');
  assert.equal(downs.length, 1, 'edição substitui o registro');
  assert.equal(downs[0].obs.LD03, 'Melhorar registro');
  const f = api(store, sup, 'formLiderado', { mat: '101' }).data;
  assert.equal(f.atual.notas.LD01, 5);
  assert.equal(api(store, sup, 'equipe').data.pessoas.find((p) => p.mat === '101').avaliado, true);
});

test('resultados: só após encerrar a fase, liberação para líderes e mínimo de respostas', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  const sup = entrar(store, '100');
  for (const [m, v] of [['101', 5], ['102', 4]]) api(store, entrar(store, m), 'enviarLider', { notas: notas('LL', 13, v), consideracoes: `comentário ${m}` });
  let r = api(store, sup, 'meusResultados').data;
  assert.equal(r.oculto, true);
  assert.equal(api(store, adm, 'resultadoLider', { lider: '100' }).data.oculto, true, 'nem a gestão vê com a fase aberta');
  api(store, adm, 'salvarConfig', { faseLideradoLider: 'FECHADA' });
  r = api(store, sup, 'meusResultados').data;
  assert.equal(r.oculto, true);
  assert.match(r.motivo, /liberou/);
  let g = api(store, adm, 'resultadoLider', { lider: '100' }).data;
  assert.equal(g.insuficiente, true);
  assert.equal(g.n, 2);
  api(store, adm, 'salvarConfig', { faseLideradoLider: 'ABERTA' });
  api(store, entrar(store, '103'), 'enviarLider', { notas: notas('LL', 13, 3) });
  api(store, adm, 'salvarConfig', { faseLideradoLider: 'FECHADA', liberar: true });
  g = api(store, adm, 'resultadoLider', { lider: '100' }).data;
  assert.equal(g.n, 3);
  assert.equal(g.media, 4);
  assert.equal(g.itens.length, 13);
  assert.deepEqual(g.itens[0].dist, [0, 0, 1, 1, 1]);
  assert.equal(g.comentarios.length, 2);
  r = api(store, sup, 'meusResultados').data;
  assert.equal(r.media, 4);
  assert.equal(r.oculto, undefined);
});

test('gestão é restrita a RH e coordenação', () => {
  const { store } = montar();
  const colab = entrar(store, '101');
  const sup = entrar(store, '100');
  for (const t of [colab, sup]) {
    for (const acao of ['painel', 'participacao', 'pessoas', 'config', 'exportar', 'importar', 'salvarPessoa', 'salvarConfig']) {
      assert.equal(api(store, t, acao, {}).code, 'PERMISSAO', acao);
    }
  }
  const rh = entrar(store, '901');
  assert.equal(api(store, rh, 'painel').ok, true);
  const p = api(store, rh, 'painel').data;
  assert.equal(p.totais.ativos, 12);
  assert.equal(p.totais.comLider, 11);
  const s1 = p.lideres.find((l) => l.mat === '100');
  assert.equal(s1.equipe, 6);
  const coord = p.lideres.find((l) => l.mat === '900');
  assert.equal(coord.equipe, 3);
});

test('cadastro: ciclos na liderança, último coordenador e o próprio acesso', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  const base = (mat) => ({ ...store.listPessoas().find((p) => p.mat === mat) });
  let r = api(store, adm, 'salvarPessoa', { ...base('100'), liderMat: '101' });
  assert.equal(r.code, 'VALIDACAO');
  assert.match(r.message, /ciclo/);
  r = api(store, adm, 'salvarPessoa', { ...base('900'), perfil: 'COLABORADOR' });
  assert.match(r.message, /Coordenação|próprio/);
  const rh = entrar(store, '901');
  r = api(store, rh, 'salvarPessoa', { ...base('900'), ativo: false });
  assert.match(r.message, /Coordenação/);
  r = api(store, adm, 'salvarPessoa', { novo: true, mat: '555', nome: 'Pessoa Nova', cc: 'IRE STC', liderMat: '200', perfil: 'COLABORADOR' });
  assert.match(r.message, /CPF/);
  r = api(store, adm, 'salvarPessoa', { novo: true, mat: '555', nome: 'Pessoa Nova', cc: 'IRE STC', liderMat: '200', perfil: 'COLABORADOR', cpf: '529.982.247-25' });
  assert.equal(r.ok, true);
  assert.equal(Core.handle(store, 'login', { mat: '555', cpf: '52998224725' }).ok, true);
  r = api(store, adm, 'salvarPessoa', { ...base('101'), liderMat: '200' });
  assert.equal(r.ok, true);
  assert.equal(api(store, entrar(store, '101'), 'home').data.meuLider.nome, 'Supervisora Dois Santos');
});

test('importação: simulação não grava; desativa ausentes sem tocar RH/coordenação', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  const antes = JSON.stringify(store.listPessoas());
  const matriz = [['MATRICULA', 'NOME', 'LIDERANÇA', 'CPF'], ['101', 'COLABORADOR 1 DE OLIVEIRA', 'SUPERVISOR UM DA SILVA', CPF[101]], ['100', 'SUPERVISOR UM DA SILVA', 'JOSE DELTA DE SA SOUZA', CPF[100]]];
  const sim = api(store, adm, 'importar', { matriz, simular: true, desativarAusentes: true }).data;
  assert.equal(sim.simulacao, true);
  assert.equal(sim.atualizados, 2);
  assert.equal(sim.desativados, 8);
  assert.equal(JSON.stringify(store.listPessoas()), antes);
  const real = api(store, adm, 'importar', { matriz, desativarAusentes: true }).data;
  assert.equal(real.desativados, 8);
  const ativos = store.listPessoas().filter((p) => p.ativo).map((p) => p.mat).sort();
  assert.deepEqual(ativos, ['100', '101', '900', '901']);
  assert.equal(Core.handle(store, 'login', { mat: '102', cpf: CPF[102] }).code, 'INATIVO');
  assert.equal(api(store, adm, 'importar', { matriz: [['Foo', 'Bar'], ['1', '2']] }).code, 'VALIDACAO');
});

test('exportação anônima esconde líderes abaixo do mínimo', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  for (const m of ['101', '102', '103']) api(store, entrar(store, m), 'enviarLider', { notas: notas('LL', 13, 4) });
  api(store, entrar(store, '201'), 'enviarLider', { notas: notas('LL', 13, 2) });
  assert.equal(api(store, adm, 'exportar', { tipo: 'liderado_lider' }).code, 'OCULTO');
  api(store, adm, 'salvarConfig', { faseLideradoLider: 'FECHADA' });
  const e = api(store, adm, 'exportar', { tipo: 'liderado_lider' }).data;
  assert.equal(e.linhas.length, 3);
  assert.ok(!e.cabecalho.some((c) => /avaliador|matrícula do liderado/i.test(c)));
  const p = api(store, adm, 'exportar', { tipo: 'participacao' }).data;
  assert.equal(p.linhas.filter((l) => l[6] === 'Sim').length, 4);
  assert.equal(api(store, adm, 'exportar', { tipo: 'pessoas' }).data.linhas.length, 12);
});

test('critérios: editar texto, desativar, mover e criar', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  let r = api(store, adm, 'salvarCriterio', { id: 'LL07', texto: 'Resolução de conflitos com imparcialidade' });
  assert.equal(r.ok, true);
  r = api(store, adm, 'salvarCriterio', { id: 'LL13', ativo: false });
  r = api(store, adm, 'salvarCriterio', { form: 'LIDERADO_LIDER', texto: 'Dá exemplo no uso de EPI' });
  assert.ok(r.data.criterios.some((c) => c.id === 'LL14'));
  r = api(store, adm, 'salvarCriterio', { id: 'LL14', mover: -1 });
  r = api(store, adm, 'salvarCriterio', { id: 'LL14', mover: -1 });
  const t = entrar(store, '101');
  const f = api(store, t, 'formLider').data;
  assert.equal(f.criterios.length, 13);
  assert.equal(f.criterios[6].texto, 'Resolução de conflitos com imparcialidade');
  assert.equal(f.criterios[11].id, 'LL14');
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 14, 4) }).ok, true);
});

test('novo ciclo zera as fases e mantém o histórico', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  api(store, entrar(store, '101'), 'enviarLider', { notas: notas('LL', 13, 4) });
  assert.equal(api(store, adm, 'salvarConfig', { novoCiclo: '2026' }).code, 'VALIDACAO');
  const r = api(store, adm, 'salvarConfig', { novoCiclo: '2027-1' }).data;
  assert.equal(r.config.ciclo, '2027-1');
  assert.equal(r.config.faseLideradoLider, 'FECHADA');
  assert.deepEqual(r.ciclos.map((c) => c.id), ['2027-1', '2026-2']);
  api(store, adm, 'salvarConfig', { faseLideradoLider: 'ABERTA' });
  const t = entrar(store, '101');
  assert.equal(api(store, t, 'home').data.avaliouLider, false);
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 13, 5) }).ok, true);
});
