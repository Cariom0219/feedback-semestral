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
// Coordenação 900 → supervisores 100 e 200, RH 901 · equipe 100: 101..106 · equipe 200: 201, 202
function montar() {
  const clock = relogio('2026-11-18T15:00:00Z');
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
  CPF[900] = cpfCom(100000900);
  store.salvarPessoa({ mat: '900', nome: 'JOSÉ DELTA DE SÁ SOUZA', cc: 'COORDENACAO', liderMat: '', liderNome: '', perfil: 'COORDENACAO', ativo: true, cpfHash: Core.hashCpf(store, '900', CPF[900]), atualizadoEm: '' });
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
const abrirFase2 = (store) => api(store, entrar(store, '900'), 'salvarConfig', { faseLiderLiderado: 'ABERTA' });
const avaliarLiderado = (store, token, mat, dados) => api(store, token, 'salvarLiderado', { mat, notas: notas('LD', 10, 4), dataFeedback: '2026-11-18', ...dados });

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
  assert.equal(Core.utdDoCC('COORDENACAO'), '');
  assert.equal(Core.normMat(' 0005 '), '5');
  assert.equal(Core.cpfValido('529.982.247-25'), true);
  assert.equal(Core.cpfValido('529.982.247-24'), false);
  assert.equal(Core.cpfValido('111.111.111-11'), false);
  assert.deepEqual(Core.mapearCabecalho(['Matricula', 'Descrição C.C', 'Liderança', 'Nome complet', 'C.P.F.']), { mat: 0, cc: 1, lider: 2, nome: 3, cpf: 4 });
  assert.equal(Core.somarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(Core.diaUtil('2026-11-21'), '2026-11-23');
});

test('importação liga liderados ao líder pelo nome, inclusive com acento', () => {
  const { store, importacao } = montar();
  assert.equal(importacao.novos, 11);
  assert.equal(importacao.lideres.find((l) => l.nome.startsWith('Jose Delta')).encontrado, false);
  const h = api(store, entrar(store, '100'), 'home');
  assert.equal(h.data.meuLider.nome, 'José Delta de Sá Souza');
  assert.equal(h.data.meuLider.coordenacao, true);
});

test('lookup mascara o nome e trata matrícula inexistente', () => {
  const { store } = montar();
  const r = Core.handle(store, 'lookup', { mat: '0101' });
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

test('Liderado x Líder: identificado, envio único e "por quê" obrigatório nas notas 1 e 2', () => {
  const { store } = montar();
  const t = entrar(store, '101');
  const f = api(store, t, 'formLider').data;
  assert.equal(f.criterios.length, 13);
  assert.equal(f.extras, false);
  assert.equal(f.notaCritica, 2);
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 12, 4) }).code, 'INCOMPLETO');
  const semPorque = api(store, t, 'enviarLider', { notas: notas('LL', 13, (i) => (i === 6 ? 2 : 4)) });
  assert.equal(semPorque.code, 'JUSTIFICAR');
  assert.equal(semPorque.campo, 'LL07');
  const ok = api(store, t, 'enviarLider', { notas: notas('LL', 13, (i) => (i === 6 ? 2 : 4)), porques: { LL07: 'Demora para resolver brigas na equipe.' }, consideracoes: '  Bom líder.  ' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(api(store, t, 'enviarLider', { notas: notas('LL', 13, 4) }).code, 'JA_ENVIADA');
  const [r] = store.listUp('2026-2');
  assert.equal(r.avaliador, '101');
  assert.equal(r.avaliado, '100');
  assert.equal(r.data, '2026-11-18');
  assert.equal(r.porques.LL07, 'Demora para resolver brigas na equipe.');
  assert.equal(r.consideracoes, 'Bom líder.');
  assert.equal(api(store, t, 'home').data.avaliouLider, true);
});

test('avaliação do coordenador exige 3 pontos fortes e 3 fracos', () => {
  const { store } = montar();
  const t = entrar(store, '100');
  assert.equal(api(store, t, 'formLider').data.extras, true);
  const base = { notas: notas('LL', 13, 5) };
  assert.equal(api(store, t, 'enviarLider', { ...base, fortes: ['a', 'b'], fracos: ['x', 'y', 'z'] }).code, 'INCOMPLETO');
  assert.equal(api(store, t, 'enviarLider', { ...base, fortes: ['Escuta', 'Organização', 'Presença'], fracos: ['Prazo', 'Feedback', 'Reuniões'] }).ok, true);
  assert.deepEqual(store.listUp()[0].fortes, ['Escuta', 'Organização', 'Presença']);
});

test('fase fechada bloqueia envio', () => {
  const { store } = montar();
  api(store, entrar(store, '900'), 'salvarConfig', { faseLideradoLider: 'FECHADA' });
  assert.equal(api(store, entrar(store, '102'), 'enviarLider', { notas: notas('LL', 13, 3) }).code, 'FASE_FECHADA');
});

test('resultado do líder: gestão vê sempre; o líder vê com nomes e "por quê" depois que a coordenação libera', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  api(store, entrar(store, '101'), 'enviarLider', { notas: notas('LL', 13, 5), consideracoes: 'comentário 101' });
  api(store, entrar(store, '102'), 'enviarLider', { notas: notas('LL', 13, (i) => (i === 0 ? 1 : 4)), porques: { LL01: 'Orientações confusas.' } });
  const sup = entrar(store, '100');
  const eq = api(store, sup, 'equipe').data;
  assert.equal(eq.pessoas.filter((p) => p.respondeu).length, 2);
  assert.ok(eq.pessoas.every((p) => !('notas' in p)), 'a lista da equipe não traz as notas');
  let r = api(store, sup, 'meusResultados').data;
  assert.equal(r.oculto, true);
  const g = api(store, adm, 'resultadoLider', { lider: '100' }).data;
  assert.equal(g.n, 2);
  assert.equal(g.respostas.length, 2);
  api(store, adm, 'salvarConfig', { liberar: true });
  r = api(store, sup, 'meusResultados').data;
  assert.equal(r.n, 2);
  assert.equal(r.respostas[0].avaliadorNome, 'Colaborador 1 de Oliveira');
  const segunda = r.respostas.find((x) => x.avaliador === '102');
  assert.equal(segunda.itens[0].nota, 1);
  assert.equal(segunda.itens[0].porque, 'Orientações confusas.');
  assert.deepEqual(r.itens[0].dist, [1, 0, 0, 0, 1]);
});

test('Líder x Liderado: só a própria equipe, fase aberta, datas, "por quê" e edição', () => {
  const { store } = montar();
  const sup = entrar(store, '100');
  const dados = { mat: '101', notas: notas('LD', 10, 4), dataFeedback: '2026-11-18', dataReavaliacao: '2027-02-18', obs: { LD03: 'Melhorar registro' }, plano: ['Chegar 10 min antes', ' '], consideracoes: 'Segue evoluindo' };
  assert.equal(api(store, sup, 'salvarLiderado', dados).code, 'FASE_FECHADA');
  abrirFase2(store);
  assert.equal(api(store, sup, 'formLiderado', { mat: '201' }).code, 'PERMISSAO');
  assert.equal(api(store, sup, 'salvarLiderado', { ...dados, dataFeedback: '' }).code, 'VALIDACAO');
  assert.equal(api(store, sup, 'salvarLiderado', { ...dados, dataReavaliacao: '2026-01-01' }).code, 'VALIDACAO');
  assert.equal(api(store, sup, 'salvarLiderado', { ...dados, notas: notas('LD', 10, (i) => (i === 9 ? 1 : 4)) }).code, 'JUSTIFICAR');
  const r1 = api(store, sup, 'salvarLiderado', dados);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.data.frequencia.tipo, 'SEMESTRAL');
  const r2 = api(store, sup, 'salvarLiderado', { ...dados, notas: notas('LD', 10, (i) => (i === 9 ? 2 : 5)), obs: { LD10: 'Esqueceu o EPI duas vezes.' } });
  assert.equal(r2.data.frequencia.tipo, 'MENSAL');
  assert.match(r2.data.frequencia.motivos[0], /nota 2 em Segurança no trabalho/);
  const downs = store.listDown('2026-2');
  assert.equal(downs.length, 1, 'edição substitui o registro');
  assert.equal(downs[0].tipo, 'PADRAO');
  assert.deepEqual(downs[0].plano, ['Chegar 10 min antes']);
  const f = api(store, sup, 'formLiderado', { mat: '101' }).data;
  assert.equal(f.atual.notas.LD01, 5);
  // feedback feito hoje vira "realizado" no cronograma
  const ag = store.listAgenda('2026-2');
  assert.equal(ag.length, 1);
  assert.equal(ag[0].status, 'REALIZADO');
});

test('coordenação avalia toda a equipe direta (supervisores, administrativo e RH) com itens de liderança e 3 fortes e 3 fracos', () => {
  const { store } = montar();
  abrirFase2(store);
  const adm = entrar(store, '900');
  const fSup = api(store, adm, 'formLiderado', { mat: '100' }).data;
  assert.equal(fSup.lideranca, true);
  assert.equal(fSup.motivoLideranca, 'EQUIPE');
  assert.equal(fSup.criterios[0].id, 'LL01');
  assert.equal(fSup.extras, true);
  const fRh = api(store, adm, 'formLiderado', { mat: '901' }).data;
  assert.equal(fRh.lideranca, true, 'quem responde direto à coordenação é avaliado como os supervisores');
  assert.equal(fRh.motivoLideranca, 'COORDENACAO');
  assert.equal(fRh.criterios.length, 13);
  assert.equal(fRh.extras, true);
  assert.equal(api(store, adm, 'salvarLiderado', { mat: '901', notas: notas('LD', 10, 4), dataFeedback: '2026-11-18' }).code, 'INCOMPLETO', 'itens do liderado não servem para a equipe direta');
  const okRh = api(store, adm, 'salvarLiderado', { mat: '901', notas: notas('LL', 13, 5), dataFeedback: '2026-11-18', fortes: ['Organizada', 'Prazos', 'Comunicação'], fracos: ['Delegar', 'Planilhas', 'Visitas'] });
  assert.equal(okRh.ok, true, JSON.stringify(okRh));
  assert.equal(store.listDown('2026-2').find((r) => r.avaliado === '901').tipo, 'LIDERANCA');
  // o supervisor continua avaliando a própria equipe com os itens do liderado
  const fMembro = api(store, entrar(store, '100'), 'formLiderado', { mat: '101' }).data;
  assert.equal(fMembro.lideranca, false);
  assert.equal(fMembro.criterios[0].id, 'LD01');
  assert.equal(api(store, adm, 'salvarLiderado', { mat: '100', notas: notas('LL', 13, 4), dataFeedback: '2026-11-18' }).code, 'INCOMPLETO');
  const ok = api(store, adm, 'salvarLiderado', { mat: '100', notas: notas('LL', 13, 4), dataFeedback: '2026-11-18', fortes: ['Segurança', 'Dados', 'Equipe unida'], fracos: ['Atrasos', 'Prazos', 'Delegar'] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const rec = store.listDown('2026-2').find((r) => r.avaliado === '100');
  assert.equal(rec.tipo, 'LIDERANCA');
  assert.deepEqual(rec.fracos, ['Atrasos', 'Prazos', 'Delegar']);
});

test('meu feedback: aparece depois da data da conversa, com ciência e frequência', () => {
  const { store, clock } = montar();
  abrirFase2(store);
  const sup = entrar(store, '100');
  avaliarLiderado(store, sup, '102', { dataFeedback: '2026-11-20', notas: notas('LD', 10, 3) });
  const t = entrar(store, '102');
  assert.equal(api(store, t, 'home').data.meuFeedback.status, 'MARCADO');
  let m = api(store, t, 'meuFeedback').data;
  assert.equal(m.status, 'MARCADO');
  assert.equal(m.dataFeedback, '2026-11-20');
  assert.equal(api(store, t, 'darCiencia').code, 'VALIDACAO');
  clock.avancar(2 * 24 * 3600 * 1000);
  const t2 = entrar(store, '102');
  m = api(store, t2, 'meuFeedback').data;
  assert.equal(m.status, 'DISPONIVEL');
  assert.equal(m.feedback.itens.length, 10);
  assert.equal(m.feedback.avaliador, 'Supervisor Um da Silva');
  assert.equal(m.frequencia.tipo, 'MENSAL');
  assert.equal(api(store, t2, 'darCiencia').ok, true);
  assert.ok(api(store, t2, 'meuFeedback').data.feedback.cienciaEm);
  assert.equal(api(store, entrar(store, '100'), 'equipe').data.pessoas.find((p) => p.mat === '102').ciencia, true);
  // sem avaliação ainda
  assert.equal(api(store, entrar(store, '103'), 'meuFeedback').data.status, 'AGUARDANDO');
});

test('frequência: limite e nota crítica configuráveis; média da equipe conta para o líder', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  abrirFase2(store);
  avaliarLiderado(store, entrar(store, '100'), '101', { notas: notas('LD', 10, (i) => (i < 5 ? 4 : 3)) });
  let eq = api(store, entrar(store, '100'), 'equipe').data;
  assert.equal(eq.pessoas.find((p) => p.mat === '101').frequencia.tipo, 'SEMESTRAL', 'média 3,5 fica semestral');
  assert.equal(api(store, adm, 'salvarConfig', { limiteMensal: '3,8' }).ok, true);
  eq = api(store, entrar(store, '100'), 'equipe').data;
  assert.equal(eq.pessoas.find((p) => p.mat === '101').frequencia.tipo, 'MENSAL');
  assert.equal(api(store, adm, 'salvarConfig', { limiteMensal: 7 }).code, 'VALIDACAO');
  // líder: a média baixa dada pela equipe leva ao mensal (na visão da gestão)
  for (const m of ['101', '102', '103']) api(store, entrar(store, m), 'enviarLider', { notas: notas('LL', 13, 3) });
  api(store, adm, 'salvarConfig', { limiteMensal: 3.5 });
  api(store, adm, 'salvarLiderado', { mat: '100', notas: notas('LL', 13, 5), dataFeedback: '2026-11-18', fortes: ['a', 'b', 'c'], fracos: ['d', 'e', 'f'] });
  const p = api(store, adm, 'participacao').data.pessoas.find((x) => x.mat === '100');
  assert.equal(p.frequencia, 'MENSAL');
});

test('cronograma: sugere datas em dias úteis, mensais depois do feedback e acompanhamento pela gestão', () => {
  const { store } = montar();
  abrirFase2(store);
  const sup = entrar(store, '100');
  avaliarLiderado(store, sup, '101', { notas: notas('LD', 10, (i) => (i === 0 ? 2 : 4)), obs: { LD01: 'Faltou duas vezes.' } });
  const g = api(store, sup, 'gerarAgenda', { inicio: '2026-11-20', porDia: 2 }).data;
  assert.equal(g.feedbacks, 5, 'os outros 5 liderados ganham data');
  assert.equal(g.acompanhamentos, 5, '5 acompanhamentos mensais para quem ficou mensal');
  const ag = store.listAgenda('2026-2').filter((a) => a.status === 'AGENDADO');
  const datas = ag.filter((a) => a.tipo === 'FEEDBACK').map((a) => a.data).sort();
  assert.deepEqual(datas, ['2026-11-20', '2026-11-20', '2026-11-23', '2026-11-23', '2026-11-24']);
  const mensais = ag.filter((a) => a.tipo === 'ACOMPANHAMENTO').map((a) => a.data).sort();
  assert.equal(mensais[0], '2026-12-18');
  assert.equal(api(store, sup, 'gerarAgenda', {}).data.feedbacks, 0, 'não duplica');
  // o líder remarca e conclui um encontro
  const eq = api(store, sup, 'equipe').data;
  const p102 = eq.pessoas.find((p) => p.mat === '102');
  const it = p102.proximo;
  assert.ok(it);
  assert.equal(api(store, sup, 'salvarAgenda', { id: it.id, liderado: '102', data: '2026-11-25', tipo: 'FEEDBACK', status: 'AGENDADO' }).ok, true);
  assert.equal(api(store, sup, 'salvarAgenda', { id: it.id, liderado: '102', data: '2026-11-25', tipo: 'FEEDBACK', status: 'REALIZADO', realizadoEm: '2026-12-01' }).code, 'VALIDACAO');
  assert.equal(api(store, sup, 'salvarAgenda', { id: it.id, liderado: '201', data: '2026-11-25' }).code, 'PERMISSAO');
  // gestão acompanha
  const ger = api(store, entrar(store, '901'), 'agendaGeral').data;
  const linha = ger.lideres.find((l) => l.mat === '100');
  assert.equal(linha.comData, 6);
  assert.equal(linha.realizados, 1);
  assert.equal(ger.totais.agendados, 10);
  assert.equal(api(store, sup, 'agendaGeral').code, 'PERMISSAO');
});

test('análises para o RH: itens mais fracos, mapa por líder, mensais e pontos de atenção', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  for (const m of ['101', '102', '103']) api(store, entrar(store, m), 'enviarLider', { notas: notas('LL', 13, (i) => (i === 6 ? 2 : 4)), porques: { LL07: 'Conflitos sem solução.' } });
  api(store, entrar(store, '201'), 'enviarLider', { notas: notas('LL', 13, 5) });
  abrirFase2(store);
  const sup = entrar(store, '100');
  for (const m of ['101', '102', '103', '104', '105']) avaliarLiderado(store, sup, m, { mat: m, notas: notas('LD', 10, (i) => (i === 1 ? 3 : 5)) });
  avaliarLiderado(store, entrar(store, '200'), '201', { notas: notas('LD', 10, 2), obs: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`LD${String(i + 1).padStart(2, '0')}`, 'baixo desempenho'])) });
  const a = api(store, adm, 'analises').data;
  assert.equal(a.liderancas.n, 4);
  assert.equal(a.liderancas.itens.slice().sort((x, y) => x.media - y.media)[0].id, 'LL07');
  assert.equal(a.liderancas.lideres.length, 2);
  assert.equal(a.liderados.n, 6);
  assert.equal(a.liderados.itens.slice().sort((x, y) => x.media - y.media)[0].id, 'LD02');
  assert.equal(a.frequencia.mensal, 1);
  assert.equal(a.frequencia.lista[0].mat, '201');
  assert.ok(a.destaques.some((d) => /Resolução de conflitos/.test(d)));
  assert.ok(a.destaques.some((d) => /acompanhamento mensal/.test(d)));
  assert.equal(api(store, sup, 'analises').code, 'PERMISSAO');
});

test('gestão é restrita a RH e coordenação', () => {
  const { store } = montar();
  for (const t of [entrar(store, '101'), entrar(store, '100')]) {
    for (const acao of ['painel', 'participacao', 'pessoas', 'config', 'exportar', 'importar', 'salvarPessoa', 'salvarConfig', 'agendaGeral', 'analises', 'resultadoLider', 'liderLiderado']) {
      assert.equal(api(store, t, acao, {}).code, 'PERMISSAO', acao);
    }
  }
  const p = api(store, entrar(store, '901'), 'painel').data;
  assert.equal(p.totais.ativos, 12);
  assert.equal(p.totais.comLider, 11);
  assert.equal(p.lideres.find((l) => l.mat === '100').equipe, 6);
  assert.equal(p.lideres.find((l) => l.mat === '900').equipe, 3);
});

test('cadastro: ciclos na liderança, último coordenador e o próprio acesso', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  const base = (mat) => ({ ...store.listPessoas().find((p) => p.mat === mat) });
  let r = api(store, adm, 'salvarPessoa', { ...base('100'), liderMat: '101' });
  assert.match(r.message, /ciclo/);
  r = api(store, adm, 'salvarPessoa', { ...base('900'), perfil: 'COLABORADOR' });
  assert.match(r.message, /Coordenação|próprio/);
  r = api(store, entrar(store, '901'), 'salvarPessoa', { ...base('900'), ativo: false });
  assert.match(r.message, /Coordenação/);
  r = api(store, adm, 'salvarPessoa', { novo: true, mat: '555', nome: 'Pessoa Nova', cc: 'IRE STC', liderMat: '200', perfil: 'COLABORADOR' });
  assert.match(r.message, /CPF/);
  r = api(store, adm, 'salvarPessoa', { novo: true, mat: '555', nome: 'Pessoa Nova', cc: 'IRE STC', liderMat: '200', perfil: 'COLABORADOR', cpf: '529.982.247-25' });
  assert.equal(r.ok, true);
  assert.equal(Core.handle(store, 'login', { mat: '555', cpf: '52998224725' }).ok, true);
  assert.equal(api(store, adm, 'salvarPessoa', { ...base('101'), liderMat: '200' }).ok, true);
  assert.equal(api(store, entrar(store, '101'), 'home').data.meuLider.nome, 'Supervisora Dois Santos');
});

test('importação: simulação não grava; desativa ausentes sem tocar RH/coordenação', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  const antes = JSON.stringify(store.listPessoas());
  const matriz = [['MATRICULA', 'NOME', 'LIDERANÇA', 'CPF'], ['101', 'COLABORADOR 1 DE OLIVEIRA', 'SUPERVISOR UM DA SILVA', CPF[101]], ['100', 'SUPERVISOR UM DA SILVA', 'JOSE DELTA DE SA SOUZA', CPF[100]]];
  const sim = api(store, adm, 'importar', { matriz, simular: true, desativarAusentes: true }).data;
  assert.equal(sim.atualizados, 2);
  assert.equal(sim.desativados, 8);
  assert.equal(JSON.stringify(store.listPessoas()), antes);
  api(store, adm, 'importar', { matriz, desativarAusentes: true });
  assert.deepEqual(store.listPessoas().filter((p) => p.ativo).map((p) => p.mat).sort(), ['100', '101', '900', '901']);
  assert.equal(Core.handle(store, 'login', { mat: '102', cpf: CPF[102] }).code, 'INATIVO');
  assert.equal(api(store, adm, 'importar', { matriz: [['Foo', 'Bar'], ['1', '2']] }).code, 'VALIDACAO');
});

test('exportações trazem quem avaliou, o por quê, frequência e cronograma', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  api(store, entrar(store, '101'), 'enviarLider', { notas: notas('LL', 13, (i) => (i === 0 ? 1 : 4)), porques: { LL01: 'Não explica o serviço.' } });
  abrirFase2(store);
  avaliarLiderado(store, entrar(store, '100'), '101', {});
  const up = api(store, adm, 'exportar', { tipo: 'liderado_lider' }).data;
  assert.ok(up.cabecalho.includes('Quem avaliou'));
  assert.equal(up.linhas[0][3], 'Colaborador 1 de Oliveira');
  assert.match(up.linhas[0].join('|'), /Comunicação e clareza nas orientações: Não explica o serviço\./);
  const down = api(store, adm, 'exportar', { tipo: 'lider_liderado' }).data;
  assert.ok(down.cabecalho.includes('Frequência'));
  assert.equal(down.linhas[0].at(-1), 'Semestral');
  const cron = api(store, adm, 'exportar', { tipo: 'cronograma' }).data;
  assert.equal(cron.linhas.length, 1);
  assert.equal(cron.linhas[0][6], 'Realizado');
  assert.equal(api(store, adm, 'exportar', { tipo: 'pessoas' }).data.linhas.length, 12);
});

test('critérios: editar texto, desativar, mover e criar', () => {
  const { store } = montar();
  const adm = entrar(store, '900');
  api(store, adm, 'salvarCriterio', { id: 'LL07', texto: 'Resolução de conflitos com imparcialidade' });
  api(store, adm, 'salvarCriterio', { id: 'LL13', ativo: false });
  const r = api(store, adm, 'salvarCriterio', { form: 'LIDERADO_LIDER', texto: 'Dá exemplo no uso de EPI' });
  assert.ok(r.data.criterios.some((c) => c.id === 'LL14'));
  api(store, adm, 'salvarCriterio', { id: 'LL14', mover: -1 });
  api(store, adm, 'salvarCriterio', { id: 'LL14', mover: -1 });
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

test('primeiro acesso da coordenação com código', () => {
  const store = MemoryStore(null, {});
  Core.importar(store, [['Matricula', 'Liderança', 'Nome', 'CPF'], ['10', 'JOSE DELTA DE SA SOUZA', 'FULANA TESTE', '111.444.777-35']], {}, 'teste');
  assert.equal(Core.handle(store, 'configurarCoordenacao', { codigo: 'X' }).code, 'INDISPONIVEL');
  store.codigoConfiguracao = () => 'AB12CD34';
  const base = { mat: '900', nome: 'José Delta de Sá Souza', cpf: '529.982.247-25' };
  assert.equal(Core.handle(store, 'configurarCoordenacao', { ...base, codigo: 'errado' }).code, 'CODIGO');
  assert.equal(Core.handle(store, 'configurarCoordenacao', { ...base, codigo: 'ab12cd34', cpf: '123' }).code, 'VALIDACAO');
  assert.equal(Core.handle(store, 'configurarCoordenacao', { ...base, codigo: 'ab12cd34' }).ok, true);
  const login = Core.handle(store, 'login', { mat: '900', cpf: '52998224725' });
  assert.equal(login.data.home.eu.admin, true);
  assert.equal(login.data.home.equipe.total, 1);
  assert.equal(Core.handle(store, 'configurarCoordenacao', { ...base, codigo: 'AB12CD34' }).code, 'JA_CONFIGURADO');
  const s2 = MemoryStore(null, {});
  s2.codigoConfiguracao = () => 'ZZZZ9999';
  for (let i = 0; i < 10; i++) Core.handle(s2, 'configurarCoordenacao', { ...base, codigo: 'x' + i });
  assert.equal(Core.handle(s2, 'configurarCoordenacao', { ...base, codigo: 'ZZZZ9999' }).code, 'BLOQUEADO');
});
