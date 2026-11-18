const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { criarAmbiente, carregar } = require('./gas-sim.js');

const { baseFicticia } = require('./base-ficticia.js');

const RAIZ = path.join(__dirname, '..');
const ARQ = [path.join(RAIZ, 'src/core.js'), path.join(RAIZ, 'src/server.gs.js')];

function chamar(g, acao, dados, token) {
  return JSON.parse(g.api(acao, JSON.stringify(dados || {}), token || ''));
}
const notas = (p, n, v) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${p}${String(i + 1).padStart(2, '0')}`, typeof v === 'function' ? v(i) : v]));

test('Apps Script ponta a ponta (base fictícia), pela página e pelo doPost', () => {
  const env = criarAmbiente();
  const g = carregar(env, ARQ);
  const ss = env.vinculada;
  const viaPost = (acao, dados, token) => {
    const out = g.doPost({ postData: { contents: JSON.stringify({ acao, dados: dados || {}, token: token || '' }) } });
    assert.equal(out.mime, 'application/json');
    return JSON.parse(out.texto);
  };

  // 0. sem preparar, a página recebe aviso claro
  env.g.__ativa = false;
  assert.equal(chamar(g, 'lookup', { mat: '101' }).code, 'CONFIG');
  assert.equal(viaPost('lookup', { mat: '101' }).code, 'CONFIG');
  env.g.__ativa = true;
  env.g.__erros.length = 0;

  // 1. preparar planilha (idempotente)
  g.prepararPlanilha();
  for (const aba of ['Config', 'Pessoas', 'Criterios', 'Participacao', 'Resp_LideradoLider', 'Resp_LiderLiderado', 'Log', 'Importar']) {
    assert.ok(ss.getSheetByName(aba), `aba ${aba}`);
  }
  assert.equal(ss.getSheetByName('Página1'), null);
  assert.equal(ss.getSheetByName('Criterios').getLastRow(), 24);
  g.prepararPlanilha();
  assert.equal(ss.getSheetByName('Criterios').getLastRow(), 24);

  // 2. cadastrar coordenação pelo menu (nome com acento casa com a base sem acento)
  env.ui.respostas.push('9999', 'COORDENADOR DELTA DE SÁ SOUZA', '529.982.247-25', 'Coordenação');
  g.cadastrarGestor();
  assert.match(env.ui.alertas.at(-1), /coordenação cadastrado/);

  // 3. colar a base na aba Importar e importar pelo menu
  const B = baseFicticia();
  const base = B.linhas.map((l) => l.map(String));
  const imp = ss.getSheetByName('Importar');
  imp.getRange(1, 1, base.length, base[0].length).setValues(base);
  env.ui.botoes.push('NO');
  g.importarDaAba();
  assert.match(env.ui.alertas.at(-1), new RegExp(B.total + ' novos'));
  assert.doesNotMatch(env.ui.alertas.at(-1), /Líderes ainda sem cadastro/);
  assert.equal(imp.getLastRow(), 0, 'aba Importar apagada (sem CPF aberto)');
  const pessoas = ss.getSheetByName('Pessoas').getRange(1, 1, B.total + 2, 10).getDisplayValues();
  assert.equal(pessoas.filter((l) => l[0]).length, B.total + 2);
  assert.equal(pessoas.flat().filter((v) => /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(v)).length, 0, 'nenhum CPF em texto aberto');

  // 4. coordenação entra pelo doPost (como no GitHub Pages) e vê o painel
  const adm = viaPost('login', { mat: '9999', cpf: '52998224725' });
  assert.equal(adm.ok, true, JSON.stringify(adm));
  const tAdm = adm.data.token;
  const painel = viaPost('painel', {}, tAdm).data;
  assert.equal(painel.totais.ativos, B.total + 1);
  assert.equal(painel.totais.comLider, B.total);
  assert.equal(painel.lideres.length, 4);

  // 5. equipe do supervisor Alfa avalia o líder; respostas esperam na fila e vão em lote
  const alfa = B.supervisores[0];
  const enviar = (m) => {
    const t = viaPost('login', { mat: m, cpf: B.cpfs[m] }).data.token;
    return viaPost('enviarLider', { notas: notas('LL', 13, (i) => 1 + ((i + Number(m)) % 5)), consideracoes: `=HYPERLINK("http://x") comentário ${m}` }, t);
  };
  for (const m of alfa.membros.slice(0, 4)) assert.equal(enviar(m).ok, true);
  assert.equal(Object.keys(env.props).filter((k) => k.startsWith('FBUP_')).length, 4);
  assert.equal(ss.getSheetByName('Resp_LideradoLider').getLastRow(), 1, 'nada na planilha antes de fechar o lote');
  assert.equal(enviar(alfa.membros[4]).ok, true);
  assert.equal(Object.keys(env.props).filter((k) => k.startsWith('FBUP_')).length, 0, 'lote de 5 gravado');
  const up = ss.getSheetByName('Resp_LideradoLider');
  const upVals = up.getRange(1, 1, up.getLastRow(), up.getLastColumn()).getDisplayValues();
  assert.equal(upVals.length, 6);
  assert.equal(upVals[0].length, 8 + 13);
  assert.match(upVals[0][8], /^LL01 · Comunicação/);
  const respondentes = new Set(alfa.membros.slice(0, 5));
  for (const l of upVals.slice(1)) {
    assert.equal(l[2], alfa.mat);
    assert.ok(![0, 1, 3, 5, 6].some((j) => respondentes.has(l[j])), 'nenhuma matrícula de quem respondeu');
    assert.ok(l[7].startsWith(' =HYPERLINK'), 'fórmula neutralizada na planilha');
    assert.ok(!l.join('|').includes('#FORMULA') && !l.join('|').includes('#DATA'));
  }
  assert.equal(enviar(alfa.membros[0]).code, 'JA_ENVIADA');

  // 6. supervisor avalia a coordenação com 3 fortes e 3 fracos (pela página)
  const tSup = chamar(g, 'login', { mat: alfa.mat, cpf: B.cpfs[alfa.mat] }).data.token;
  const f = chamar(g, 'formLider', {}, tSup).data;
  assert.equal(f.extras, true);
  assert.equal(f.lider.nome, 'Coordenador Delta de Sá Souza');
  assert.equal(chamar(g, 'enviarLider', { notas: notas('LL', 13, 4), fortes: ['Escuta', 'Presença', 'Dados'], fracos: ['Prazos', 'Reuniões', 'Delegar'] }, tSup).ok, true);
  const eq = chamar(g, 'equipe', {}, tSup).data;
  assert.equal(eq.pessoas.length, alfa.equipe);
  assert.equal(eq.pessoas.filter((p) => p.respondeu).length, 5);

  // 7. resultados escondidos até fechar a fase; fechar grava a fila
  assert.equal(chamar(g, 'meusResultados', {}, tSup).data.oculto, true);
  assert.equal(viaPost('salvarConfig', { faseLideradoLider: 'FECHADA', liberar: true }, tAdm).ok, true);
  assert.equal(Object.keys(env.props).filter((k) => k.startsWith('FBUP_')).length, 0);
  assert.equal(up.getLastRow(), 7);
  const r = chamar(g, 'meusResultados', {}, tSup).data;
  assert.equal(r.n, 5);
  assert.equal(r.itens.length, 13);
  assert.ok(r.comentarios.every((c) => c.startsWith('=HYPERLINK')), 'texto volta igual ao digitado');
  assert.equal(viaPost('resultadoLider', { lider: '9999' }, tAdm).data.insuficiente, true, 'só 1 resposta para a coordenação: oculta');

  // 8. Líder x Liderado com edição na mesma linha
  viaPost('salvarConfig', { faseLiderLiderado: 'ABERTA' }, tAdm);
  const alvo = alfa.membros[0];
  const s1 = chamar(g, 'salvarLiderado', { mat: alvo, notas: notas('LD', 10, 3), dataFeedback: '2026-11-18', obs: { LD02: 'Atrasos na segunda' } }, tSup);
  assert.equal(s1.ok, true, JSON.stringify(s1));
  assert.equal(chamar(g, 'salvarLiderado', { mat: alvo, notas: notas('LD', 10, 5), dataFeedback: '2026-11-18', dataReavaliacao: '2027-02-18' }, tSup).data.media, 5);
  const down = ss.getSheetByName('Resp_LiderLiderado');
  assert.equal(down.getLastRow(), 2);
  const dl = down.getRange(2, 1, 1, down.getLastColumn()).getDisplayValues()[0];
  assert.deepEqual([dl[2], dl[4], dl[7]], [alfa.mat, alvo, '2027-02-18']);
  assert.equal(chamar(g, 'formLiderado', { mat: alvo }, tSup).data.atual.notas.LD05, 5);
  assert.equal(viaPost('liderLiderado', {}, tAdm).data.registros.length, 1);

  // 9. exportação, cadastro e importação pela página
  assert.equal(viaPost('exportar', { tipo: 'liderado_lider' }, tAdm).data.linhas.length, 5);
  const nova = viaPost('salvarPessoa', { novo: true, mat: '2001', nome: 'Pessoa Teste', cc: 'IRE STC', liderMat: '103', perfil: 'COLABORADOR', cpf: '11144477735' }, tAdm);
  assert.equal(nova.ok, true, JSON.stringify(nova));
  assert.equal(viaPost('login', { mat: '2001', cpf: '111.444.777-35' }).data.home.meuLider.nome, 'Supervisor Gama Rocha');
  const sim = viaPost('importar', { matriz: base, simular: true }, tAdm).data;
  assert.equal(sim.atualizados, B.total);

  // 10. pedido inválido pelo doPost não derruba nada
  const ruim = JSON.parse(g.doPost({ postData: { contents: 'isto não é json' } }).texto);
  assert.equal(ruim.ok, false);
  assert.equal(JSON.parse(g.doPost(undefined).texto).ok, false);

  // 11. log cresce além de 1000 linhas sem quebrar
  const store = g.PlanilhaStore();
  for (let i = 0; i < 1100; i++) store.log('x', 'teste', '');
  assert.ok(ss.getSheetByName('Log').getLastRow() > 1100);

  // 12. página
  const out = g.doGet();
  assert.equal(out.arquivo, 'Index');
  assert.equal(out.xframe, 'ALLOWALL');
  assert.deepEqual(env.g.__erros, []);
});

test('fila de respostas é gravada pelo menu e ao iniciar novo ciclo', () => {
  const env = criarAmbiente();
  const g = carregar(env, ARQ);
  g.prepararPlanilha();
  env.ui.respostas.push('1', 'COORD TESTE', '529.982.247-25', 'COORDENACAO');
  g.cadastrarGestor();
  const ss = env.vinculada;
  const imp = ss.getSheetByName('Importar');
  const linhas = [['Matricula', 'Liderança', 'Nome', 'CPF'], ['2', 'COORD TESTE', 'FULANO DE TAL', '111.444.777-35'], ['3', 'COORD TESTE', 'BELTRANO', '01234567890']];
  imp.getRange(1, 1, 3, 4).setValues(linhas);
  env.ui.botoes.push('NO');
  g.importarDaAba();
  assert.match(env.ui.alertas.at(-1), /2 novos/);
  // CPF que começa com zero e foi gravado como número volta a ter 11 dígitos
  assert.equal(chamar(g, 'login', { mat: '3', cpf: '012.345.678-90' }).ok, true);
  const t = chamar(g, 'login', { mat: '2', cpf: '11144477735' }).data.token;
  assert.equal(chamar(g, 'enviarLider', { notas: notas('LL', 13, 5), fortes: ['a', 'b', 'c'], fracos: ['d', 'e', 'f'] }, t).ok, true);
  assert.equal(Object.keys(env.props).filter((k) => k.startsWith('FBUP_')).length, 1);
  g.gravarFila();
  assert.match(env.ui.alertas.at(-1), /1 resposta/);
  assert.equal(ss.getSheetByName('Resp_LideradoLider').getLastRow(), 2);
  const tAdm = chamar(g, 'login', { mat: '1', cpf: '52998224725' }).data.token;
  assert.equal(chamar(g, 'enviarLider', {}, 'token-invalido-com-mais-de-vinte-chars').code, 'SESSAO');
  const nc = chamar(g, 'salvarConfig', { novoCiclo: '2027-1' }, tAdm);
  assert.equal(nc.data.config.ciclo, '2027-1');
  assert.equal(chamar(g, 'home', {}, t).data.ciclo, '2027-1');
  assert.deepEqual(env.g.__erros, []);
});
