// Teste de navegador com Playwright + Chrome:
//  1) demonstração (docs/demo): fluxos dos 4 perfis, celular e computador, tema escuro;
//  2) aplicativo oficial (docs/index.html) falando com o servidor por fetch, como no GitHub Pages + Supabase.
// Uso: npm run test:ui   (variáveis opcionais: PLAYWRIGHT, XLSX, CHROME)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const XLSX = require(process.env.XLSX || 'xlsx');
const Core = require('../src/core.js');
const { MemoryStore } = require('../src/store-memory.js');
const { baseFicticia } = require('./base-ficticia.js');

const RAIZ = path.join(__dirname, '..');
const URL = 'http://localhost:9999/index.html';
const DEMO_HTML = path.join(RAIZ, 'docs/demo/index.html');
const OFICIAL_HTML = path.join(RAIZ, 'docs/index.html');
const SHOTS = path.join(os.tmpdir(), 'feedback-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const XLSX_LOCAL = path.join(path.dirname(require.resolve((process.env.XLSX || 'xlsx') + '/package.json')), 'dist/xlsx.full.min.js');
// planilha fictícia no formato da base real, para testar a importação
const BASE_TESTE = path.join(os.tmpdir(), 'base_ficticia.xlsx');
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(baseFicticia().linhas), 'Planilha1');
  XLSX.writeFile(wb, BASE_TESTE);
}

let falhas = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.log('  ✗ ' + msg); }
}

let CTX = null;
async function novaPagina(browser, opts = {}) {
  if (!CTX) {
    CTX = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await CTX.route('http://localhost:9999/**', (r) => r.fulfill({ path: DEMO_HTML, contentType: 'text/html; charset=utf-8' }));
  }
  const ctx = { close: async () => { await page.close(); } };
  const page = await CTX.newPage();
  await page.setViewportSize(opts.viewport || { width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: opts.dark ? 'dark' : 'light' });
  const erros = [];
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/i.test(m.text())) erros.push('console: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\/xlsx\.full\.min\.js/, (r) => r.fulfill({ path: XLSX_LOCAL, contentType: 'application/javascript' }));
  page.erros = erros;
  return { ctx, page };
}

async function entrar(page, perfil) {
  await page.getByRole('button', { name: 'Restaurar dados' }).isVisible();
  const linha = page.locator('.linha-pessoa', { hasText: perfil }).first();
  await linha.getByRole('button', { name: 'Usar' }).click();
  await page.getByRole('button', { name: 'Sim, sou eu' }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { level: 1, name: /^Olá,/ }).waitFor();
}
async function sair(page) { await page.getByRole('button', { name: 'Sair' }).click(); await page.getByRole('heading', { name: 'Avaliação de liderança' }).waitFor(); }
async function notasTodas(page, valor) {
  const grupos = page.locator('.notas');
  const n = await grupos.count();
  for (let i = 0; i < n; i++) await grupos.nth(i).locator('.nota').nth(valor(i) - 1).click();
  return n;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--no-sandbox'] } : {});

  console.log('Colaborador (celular)');
  {
    const { ctx, page } = await novaPagina(browser);
    await page.goto(URL);
    await page.evaluate(() => window.FB_DEMO_RESET && window.FB_DEMO_RESET());
    await page.reload();
    await page.screenshot({ path: path.join(SHOTS, '01-login.png'), fullPage: true });
    ok(!(await page.locator('body').innerText()).includes('anônim'), 'entrada não fala mais em anonimato');
    await page.locator('#mat').fill('77777');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.locator('.erro').waitFor();
    ok((await page.locator('.erro').innerText()).includes('não encontrada'), 'matrícula inexistente avisa');
    await page.locator('#mat').fill('1001');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByText('Ana B. Moura').waitFor();
    ok(await page.getByText('Ana B. Moura').isVisible(), 'confirmação mostra nome mascarado');
    await page.getByRole('button', { name: 'Sim, sou eu' }).click();
    await page.locator('#cpf').fill('11111111111');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.locator('.erro').waitFor();
    ok(/Restam 4 tentativas/.test(await page.locator('.erro').innerText()), 'CPF errado conta tentativas');
    await page.getByRole('button', { name: 'Trocar matrícula' }).click();
    await entrar(page, 'Colaborador');
    ok(await page.getByText('Olá, Ana').isVisible(), 'entrou como Ana');
    const cards = await page.locator('.card-acao h2').allInnerTexts();
    ok(cards.join('|') === 'Avaliar meu líder|Meu feedback', 'cards da colaboradora: ' + cards.join('|'));
    ok(await page.getByText('Confirme a conversa').isVisible(), 'card do feedback pede a confirmação da conversa');
    await page.screenshot({ path: path.join(SHOTS, '02-inicio-colaborador.png'), fullPage: true });
    await page.getByRole('button', { name: 'Começar avaliação' }).click();
    await page.getByRole('heading', { name: /Avaliação de Edson/ }).waitFor();
    ok(await page.locator('.item').count() === 13, '13 itens no formulário');
    ok(await page.locator('#extras').count() === 0, 'sem pontos fortes/fracos para supervisor');
    ok(/vai ver a sua avaliação com o seu nome/.test(await page.locator('.aviso').first().innerText()), 'avisa que a avaliação é identificada');
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    ok(await page.locator('.item.falta').count() === 13, 'itens sem nota destacados');
    await notasTodas(page, (i) => (i % 5) + 1);
    ok((await page.locator('.progresso').innerText()).includes('13 de 13'), 'progresso 13/13');
    ok(await page.locator('#item-LL01 .porque.obrig').isVisible(), 'nota 1 abre o "Por quê?" obrigatório');
    ok(await page.locator('#item-LL03 .porque:not(.obrig)').isVisible(), 'nota 3 abre o "Por quê?" opcional');
    ok(await page.locator('#item-LL04').getByRole('button', { name: 'Explicar o porquê (opcional)' }).isVisible(), 'nota 4 deixa o porquê num link');
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    ok(await page.locator('.item.falta').count() === 6, 'cobra o porquê das 6 notas 1 e 2: ' + await page.locator('.item.falta').count());
    for (const id of ['LL01', 'LL02', 'LL06', 'LL07', 'LL11', 'LL12']) await page.locator('#pq-' + id).fill('Exemplo concreto do que aconteceu no item ' + id + '.');
    ok(await page.locator('.item.falta').count() === 0, 'destaque some depois do porquê');
    await page.locator('#cons').fill('Explica bem o serviço. Poderia dar mais retorno individual.');
    await page.screenshot({ path: path.join(SHOTS, '03-form-lider.png'), fullPage: false });
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar' }).click();
    await page.getByRole('heading', { name: 'Avaliação enviada' }).waitFor();
    ok(true, 'avaliação enviada');
    await page.getByRole('button', { name: 'Voltar ao início' }).click();
    await page.getByText(/Enviada em/).waitFor();
    await page.getByRole('button', { name: 'Ver meu feedback' }).click();
    await page.getByRole('heading', { level: 1, name: 'Meu feedback' }).waitFor();
    ok((await page.locator('.hero-num').innerText()).includes('de 5'), 'painel mostra a média do feedback');
    ok(await page.locator('.nota-linha').count() === 10, 'feedback com as 10 notas');
    ok(await page.locator('.hero .chip', { hasText: 'Feedback semestral' }).isVisible(), 'mostra a frequência (semestral)');
    ok(await page.getByRole('heading', { name: 'Sua evolução' }).isVisible(), 'mostra a evolução entre ciclos');
    await page.screenshot({ path: path.join(SHOTS, '04-meu-feedback.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirmar que conversamos' }).click();
    await page.getByText(/Você confirmou a conversa em/).waitFor();
    ok(true, 'ciência registrada');
    ok(page.erros.length === 0, 'sem erros no console: ' + page.erros.join(' | '));
    await ctx.close();
  }

  console.log('Supervisor (celular)');
  {
    const { ctx, page } = await novaPagina(browser);
    await page.goto(URL);
    await entrar(page, 'Supervisor');
    const cards = await page.locator('.card-acao h2').allInnerTexts();
    ok(cards.join('|') === 'Avaliar meu líder|Meu feedback|Avaliar meus liderados|4 conversas nos próximos 7 dias|8 de 12 avaliaram você|Como a equipe me avaliou', 'cards do supervisor: ' + cards.join('|'));
    await page.screenshot({ path: path.join(SHOTS, '05-inicio-supervisor.png'), fullPage: true });
    await page.getByRole('button', { name: 'Começar avaliação' }).click();
    await page.getByRole('heading', { name: /Avaliação de Marcos/ }).waitFor();
    ok(await page.locator('#extras fieldset').count() === 2, 'avaliação do coordenador tem fortes e fracos');
    await notasTodas(page, () => 4);
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    ok(await page.locator('.grupo-extra.falta').count() === 2, 'cobra os 3 fortes e 3 fracos');
    for (const [k, vals] of [['fortes', ['Acompanha de perto', 'Usa dados', 'Disponível']], ['fracos', ['Reuniões longas', 'Prazos curtos', 'Delegar mais']]]) {
      for (let i = 0; i < 3; i++) await page.locator(`#${k}-${i}`).fill(vals[i]);
    }
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar' }).click();
    await page.getByRole('heading', { name: 'Avaliação enviada' }).waitFor();
    await page.getByRole('button', { name: 'Voltar ao início' }).click();
    await page.getByRole('button', { name: 'Ver quem respondeu' }).click();
    await page.getByRole('heading', { name: 'Minha equipe' }).waitFor();
    await page.locator('.lista .linha-pessoa').first().waitFor();
    ok((await page.locator('.lista .linha-pessoa').count()) === 12, 'equipe com 12 pessoas');
    await page.getByRole('button', { name: /^Pendentes/ }).click();
    ok((await page.locator('.lista .linha-pessoa').count()) === 4, '4 pendentes');
    await page.getByRole('button', { name: /Copiar pendentes/ }).click();
    const copiado = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(copiado.includes('Ana') === false && copiado.includes('Daniela Rocha Pires') && !copiado.includes('anônimo'), 'texto de pendentes para WhatsApp');
    await page.getByRole('tab', { name: 'Avaliar liderados' }).click();
    await page.getByRole('heading', { name: /liderados avaliados/ }).waitFor();
    const avaliados = () => page.locator('.lista .linha-pessoa .chip.ok', { hasText: 'Avaliado' }).count();
    ok((await avaliados()) === 4, '4 já avaliados no ciclo');
    await page.getByRole('button', { name: 'Avaliar', exact: true }).first().click();
    await page.getByRole('heading', { level: 1 }).filter({ hasText: /Bruno/ }).waitFor();
    ok(await page.locator('#dataF').inputValue() !== '', 'data do feedback vem do cronograma');
    await page.getByRole('button', { name: '+3 meses' }).click();
    ok((await page.locator('#dataR').inputValue()).length === 10, 'reavaliação +3 meses');
    await notasTodas(page, (i) => (i < 5 ? 5 : 3));
    await page.locator('#pq-LD06').fill('Ajudar mais os colegas quando terminar a rota antes.');
    await page.locator('#plano-0').fill('Ajudar um colega novo por semana.');
    const prog = await page.locator('.progresso').innerText();
    ok(prog.includes('4,0') && prog.includes('feedback semestral'), 'média ao vivo 4,0 e frequência prevista');
    await page.screenshot({ path: path.join(SHOTS, '06-form-liderado.png'), fullPage: false });
    await page.getByRole('button', { name: 'Salvar e ir para o próximo' }).click();
    await page.getByRole('heading', { level: 1 }).filter({ hasText: /Carlos/ }).waitFor();
    ok(true, 'foi para o próximo pendente (Carlos)');
    await page.getByRole('button', { name: 'Minha equipe' }).click();
    await page.getByRole('heading', { name: /liderados avaliados/ }).waitFor();
    ok((await avaliados()) === 5, 'agora 5 avaliados');
    // cronograma
    await page.getByRole('tab', { name: 'Cronograma' }).click();
    await page.getByRole('button', { name: 'Sugerir datas' }).waitFor();
    ok((await page.locator('.kpi').nth(3).innerText()).startsWith('3'), '3 liderados sem data');
    await page.screenshot({ path: path.join(SHOTS, '07-cronograma.png'), fullPage: true });
    await page.getByRole('button', { name: 'Sugerir datas' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sugerir datas' }).click();
    await page.getByText(/Marcados 3 feedbacks/).waitFor();
    ok(true, 'sugeriu 3 datas de feedback');
    ok(await page.waitForFunction(() => /^0/.test((document.querySelectorAll('.kpi')[3] || {}).innerText || ''), null, { timeout: 5000 }).then(() => true, () => false), 'ninguém mais sem data');
    await page.getByRole('button', { name: 'Remarcar' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar nova data' }).click();
    await page.getByText(/Conversa remarcada para/).waitFor();
    ok(true, 'conversa remarcada');
    await page.getByRole('button', { name: 'Feito', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Abrir avaliação' }).click();
    await page.getByRole('heading', { level: 1 }).filter({ hasText: /Igor/ }).waitFor();
    ok(true, 'feedback atrasado sem avaliação leva para a avaliação');
    await page.getByRole('button', { name: 'Minha equipe' }).click();
    await page.getByRole('tab', { name: 'Painel da equipe' }).click();
    await page.getByRole('heading', { name: 'Média por item' }).waitFor();
    ok((await page.locator('.res-item').count()) === 10, 'painel da equipe com 10 itens');
    await page.screenshot({ path: path.join(SHOTS, '08-painel-equipe.png'), fullPage: true });
    // resultado do líder
    await page.getByRole('button', { name: 'Início', exact: true }).click();
    await page.getByRole('button', { name: 'Ver resultado' }).click();
    await page.getByRole('heading', { name: 'Como a equipe me avaliou' }).waitFor();
    await page.getByText(/ainda não liberou o resultado deste ciclo/).waitFor();
    ok(true, 'resultado do ciclo atual aguarda a liberação');
    await page.locator('#selCiclo').selectOption('2026-1');
    await page.locator('.res-item').first().waitFor();
    ok((await page.locator('.res-item').count()) === 13, 'resultado 2026-1 com 13 itens');
    const respostas = await page.locator('details.resp').count();
    ok(respostas >= 5, 'avaliação de cada pessoa, com nome: ' + respostas);
    await page.locator('details.resp summary').first().click();
    ok((await page.locator('details.resp[open] .nota-linha').count()) === 13, 'abre as 13 notas de quem respondeu');
    await page.screenshot({ path: path.join(SHOTS, '09-resultado-supervisor.png'), fullPage: true });
    ok(page.erros.length === 0, 'sem erros no console: ' + page.erros.join(' | '));
    await ctx.close();
  }

  console.log('Coordenação (computador)');
  {
    const { ctx, page } = await novaPagina(browser, { viewport: { width: 1280, height: 900 } });
    await page.goto(URL);
    await entrar(page, 'Coordenação');
    await page.getByRole('button', { name: 'Abrir painel' }).click();
    await page.locator('table').first().waitFor();
    ok((await page.locator('tbody tr').count()) === 4, '4 líderes na visão geral (3 supervisores + coordenação)');
    await page.screenshot({ path: path.join(SHOTS, '10-painel.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Participação' }).click();
    await page.locator('#fStatus').waitFor();
    await page.locator('tbody tr').nth(5).waitFor();
    await page.locator('#fStatus').selectOption('pend1');
    const pend = await page.locator('tbody tr').count();
    ok(pend > 0 && pend < 36, 'filtro de pendentes: ' + pend);
    await page.locator('#fLider').selectOption({ label: 'Rogerio Batista Freitas' });
    ok((await page.locator('tbody tr').count()) === 2, 'pendentes do Rogério: 2');
    await page.getByRole('tab', { name: 'Liderado x Líder' }).click();
    await page.locator('#selLider').waitFor();
    await page.locator('.res-item').first().waitFor();
    ok(true, 'gestão vê o resultado do ciclo atual sem esperar');
    await page.locator('#selLider').selectOption('9001');
    await page.getByRole('heading', { name: 'Pontos fortes' }).waitFor();
    ok((await page.locator('details.resp').count()) === 3, 'coordenação vê as 3 avaliações recebidas, com nome');
    await page.screenshot({ path: path.join(SHOTS, '11-resultado-coord.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Líder x Liderado' }).click();
    await page.locator('#fLL').waitFor();
    await page.locator('tbody tr').first().click();
    await page.getByRole('dialog').waitFor();
    ok((await page.getByRole('dialog').locator('.nota-linha').count()) === 10, 'detalhe com 10 notas');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Cronograma' }).click();
    await page.locator('#agStatus').waitFor();
    ok((await page.locator('table').first().locator('tbody tr').count()) === 4, 'cronograma por líder');
    await page.locator('#agStatus').selectOption('atrasados');
    ok((await page.locator('table').nth(1).locator('tbody tr').count()) >= 1, 'filtra conversas atrasadas');
    await page.getByRole('button', { name: 'Copiar atrasados' }).click();
    const atrasados = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(atrasados.includes('Feedbacks atrasados'), 'copia os atrasados por líder');
    await page.screenshot({ path: path.join(SHOTS, '12-cronograma-geral.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Análises' }).click();
    await page.getByRole('heading', { name: 'Pontos de atenção' }).waitFor();
    ok((await page.locator('.mapa').count()) === 2, 'mapas por líder e por equipe');
    ok((await page.locator('.mapa td.cel').count()) >= 40, 'células do mapa preenchidas');
    ok(await page.getByRole('heading', { name: 'Gestão avaliando os líderes' }).isVisible(), 'mostra a avaliação que a gestão fez dos líderes');
    ok(await page.getByRole('heading', { name: 'Acompanhamento mensal' }).isVisible(), 'lista o acompanhamento mensal');
    await page.screenshot({ path: path.join(SHOTS, '13-analises.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Pessoas' }).click();
    await page.locator('#buscaPes').waitFor();
    await page.locator('#buscaPes').fill('zeca');
    ok((await page.locator('tbody tr').count()) === 1, 'busca de pessoa');
    await page.locator('tbody tr').first().click();
    await page.locator('#pCC').fill('ITA STC EQUIPE 2');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Cadastro atualizado.').waitFor();
    ok(true, 'edição de pessoa salva');
    await page.getByRole('button', { name: 'Nova pessoa' }).click();
    await page.locator('#pMat').fill('1099');
    await page.locator('#pNome').fill('Pessoa de Teste');
    await page.locator('#pCC').fill('IRE STC');
    await page.locator('#pLider').selectOption('9103');
    await page.locator('#pCpf').fill('52998224725');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Pessoa cadastrada.').waitFor();
    ok(true, 'nova pessoa cadastrada');
    {
      const total = baseFicticia().total;
      await page.getByRole('button', { name: /Importar base/ }).click();
      await page.locator('#arqBase').setInputFiles(BASE_TESTE);
      await page.getByText('linhas lidas').waitFor({ timeout: 15000 });
      const txt = (await page.getByRole('dialog').innerText()).replace(/\n/g, ' ');
      ok(new RegExp(total + '\\s*linhas lidas').test(txt), 'importação lê as ' + total + ' linhas do .xlsx');
      ok(txt.includes('Supervisor Alfa Santos') && txt.includes('Sem cadastro'), 'lista líderes e aponta quem está sem cadastro');
      await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    }
    await page.getByRole('tab', { name: 'Fases e ciclo' }).click();
    await page.locator('.interruptor').first().waitFor();
    await page.locator('#limiteMensal').fill('3.8');
    await page.locator('#notaCritica').selectOption('2');
    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await page.getByText('Regra de frequência salva.').waitFor();
    ok((await page.locator('#limiteMensal').inputValue()) === '3.8', 'limite do mensal mudou para 3,8');
    await page.locator('#limiteMensal').fill('3.5');
    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await page.getByText('Regra de frequência salva.').first().waitFor();
    await page.locator('.interruptor').first().getByRole('button', { name: 'Fechada' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar avaliação' }).click();
    await page.getByText('Avaliação do líder fechada.').waitFor();
    await page.getByRole('button', { name: 'Liberar resultado' }).click();
    await page.getByText('Resultado liberado para os líderes.').waitFor();
    ok(true, 'fase 1 fechada e resultado liberado');
    await page.screenshot({ path: path.join(SHOTS, '14-config.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Liderado x Líder' }).click();
    await page.locator('.res-item').first().waitFor();
    await page.getByRole('button', { name: 'Exportar respostas' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Copiar tabela' }).click();
    const tabela = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(tabela.split('\n')[0].startsWith('Ciclo\tLíder avaliado') && tabela.split('\n')[0].includes('Quem avaliou'), 'exportação com quem avaliou');
    ok(page.erros.length === 0, 'sem erros no console: ' + page.erros.join(' | '));
    await ctx.close();
  }

  console.log('RH e tema escuro');
  {
    const { ctx, page } = await novaPagina(browser, { dark: true });
    await page.goto(URL);
    await entrar(page, 'RH');
    const cards = await page.locator('.card-acao h2').allInnerTexts();
    ok(cards.join('|') === 'Avaliar meu líder|Meu feedback|Painel de gestão', 'cards do RH: ' + cards.join('|'));
    await page.screenshot({ path: path.join(SHOTS, '15-rh-escuro.png'), fullPage: true });
    await page.getByRole('button', { name: 'Abrir painel' }).click();
    await page.getByRole('tab', { name: 'Análises' }).click();
    await page.getByRole('heading', { name: 'Pontos de atenção' }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, '16-analises-escuro.png'), fullPage: true });
    await page.getByRole('button', { name: 'Início', exact: true }).click();
    await sair(page);
    await entrar(page, 'Supervisor');
    await page.getByRole('button', { name: 'Ver resultado' }).click();
    await page.locator('.res-item').first().waitFor();
    ok((await page.locator('.res-item').count()) === 13, 'supervisor vê o resultado atual depois de liberado');
    ok((await page.locator('details.resp').count()) === 8, 'com a avaliação de cada uma das 8 pessoas que responderam');
    await page.locator('details.resp summary').first().click();
    await page.screenshot({ path: path.join(SHOTS, '17-resultado-escuro.png'), fullPage: true });
    ok(page.erros.length === 0, 'sem erros no console: ' + page.erros.join(' | '));
    await ctx.close();
  }

  console.log('Aplicativo oficial (GitHub Pages → Supabase por fetch)');
  {
    const API = 'https://exemplo.supabase.co/functions/v1/feedback';
    const B = baseFicticia();
    const store = MemoryStore();
    Core.importar(store, B.linhas, {});
    store.salvarPessoa({ mat: '9999', nome: 'COORDENADOR DELTA DE SA SOUZA', cc: '', liderMat: '', liderNome: '', perfil: 'COORDENACAO', ativo: true, cpfHash: Core.hashCpf(store, '9999', '52998224725'), atualizadoEm: '' });
    let configJs = "window.FB_API_URL = '';";
    let chamadas = 0;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('http://localhost:9998/index.html', (r) => r.fulfill({ path: OFICIAL_HTML, contentType: 'text/html; charset=utf-8' }));
    await ctx.route('http://localhost:9998/config.js', (r) => r.fulfill({ body: configJs, contentType: 'application/javascript' }));
    await ctx.route(API, async (r) => {
      chamadas++;
      const req = r.request();
      const corpo = JSON.parse(req.postData() || '{}');
      const semPreflight = req.method() === 'POST' && !/json/i.test(req.headers()['content-type'] || '');
      const resposta = semPreflight ? Core.handle(store, corpo.acao, corpo.dados || {}, corpo.token || '') : { ok: false, code: 'CORS', message: 'pedido com pré-verificação' };
      await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(resposta) });
    });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.goto('http://localhost:9998/index.html');
    await page.getByText('ainda não está ligado ao servidor').waitFor();
    ok(await page.getByRole('link', { name: 'Ver a demonstração' }).isVisible(), 'sem endereço do servidor: aviso e link da demonstração');
    configJs = "window.FB_API_URL = '" + API + "';";
    await page.reload();
    const membro = B.supervisores[1].membros[0];
    await page.locator('#mat').fill(membro);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Sim, sou eu' }).click();
    await page.locator('#cpf').fill(B.cpfs[membro]);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('heading', { name: /^Olá,/ }).waitFor();
    await page.getByRole('button', { name: 'Começar avaliação' }).click();
    await page.getByRole('heading', { name: /Avaliação de Supervisora Beta Lima/ }).waitFor();
    await notasTodas(page, () => 5);
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar' }).click();
    await page.getByRole('heading', { name: 'Avaliação enviada' }).waitFor();
    ok(store.listParticipacao().length === 1 && store.listUp().length === 1 && store.listUp()[0].avaliador === membro, 'resposta identificada chegou ao servidor por fetch');
    ok(chamadas === 4, 'entrada, formulário e envio passaram pelo servidor (' + chamadas + ' chamadas)');
    await page.getByRole('button', { name: 'Voltar ao início' }).click();
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.getByRole('heading', { name: 'Avaliação de liderança' }).waitFor();
    ok(erros.length === 0, 'sem erros na página: ' + erros.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
