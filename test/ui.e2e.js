// Teste de navegador com Playwright + Chrome:
//  1) demonstração (docs/demo): fluxos dos 4 perfis, celular e computador, tema escuro;
//  2) aplicativo oficial (docs/index.html) falando com o servidor por fetch, como no GitHub Pages.
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
    // matrícula errada
    await page.locator('#mat').fill('77777');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.locator('.erro').waitFor();
    ok((await page.locator('.erro').innerText()).includes('não encontrada'), 'matrícula inexistente avisa');
    // CPF errado
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
    await page.screenshot({ path: path.join(SHOTS, '02-inicio-colaborador.png'), fullPage: true });
    await page.getByRole('button', { name: 'Começar avaliação' }).click();
    await page.getByRole('heading', { name: /Avaliação de Edson/ }).waitFor();
    ok(await page.locator('.item').count() === 13, '13 itens no formulário');
    ok(await page.locator('#extras').count() === 0, 'sem pontos fortes/fracos para supervisor');
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    ok(await page.locator('.item.falta').count() === 13, 'itens sem nota destacados');
    await notasTodas(page, (i) => (i % 5) + 1);
    ok(await page.locator('.item.falta').count() === 0, 'destaque some após nota');
    ok((await page.locator('.progresso').innerText()).includes('13 de 13'), 'progresso 13/13');
    await page.locator('#cons').fill('Explica bem o serviço. Poderia dar mais retorno individual.');
    await page.screenshot({ path: path.join(SHOTS, '03-form-lider.png'), fullPage: false });
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar' }).click();
    await page.getByRole('heading', { name: 'Avaliação enviada' }).waitFor();
    ok(true, 'avaliação enviada');
    await page.getByRole('button', { name: 'Voltar ao início' }).click();
    await page.getByText(/Enviada em/).waitFor();
    ok(true, 'início mostra "Enviada em"');
    ok(page.erros.length === 0, 'sem erros no console: ' + page.erros.join(' | '));
    await ctx.close();
  }

  console.log('Supervisor (celular)');
  {
    const { ctx, page } = await novaPagina(browser);
    await page.goto(URL);
    await entrar(page, 'Supervisor');
    const cards = await page.locator('.card-acao h2').allInnerTexts();
    ok(cards.join('|') === 'Avaliar meu líder|Avaliar meus liderados|8 de 12 avaliaram você|Como a equipe me avaliou', 'cards do supervisor: ' + cards.join('|'));
    await page.screenshot({ path: path.join(SHOTS, '04-inicio-supervisor.png'), fullPage: true });
    await page.getByRole('button', { name: 'Começar avaliação' }).click();
    await page.getByRole('heading', { name: /Avaliação de Marcos/ }).waitFor();
    ok(await page.locator('#extras fieldset').count() === 2, 'avaliação do coordenador tem fortes e fracos');
    await notasTodas(page, () => 4);
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    ok(await page.locator('.grupo-extra.falta').count() === 2, 'cobra os 3 fortes e 3 fracos');
    for (const [k, vals] of [['fortes', ['Acompanha de perto', 'Usa dados', 'Disponível']], ['fracos', ['Reuniões longas', 'Prazos curtos', 'Delegar mais']]]) {
      for (let i = 0; i < 3; i++) await page.locator(`#${k}-${i}`).fill(vals[i]);
    }
    await page.screenshot({ path: path.join(SHOTS, '05-extras-coordenador.png'), fullPage: false });
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
    ok(await page.getByRole('button', { name: /Copiar pendentes/ }).isVisible(), 'botão copiar pendentes');
    await page.getByRole('button', { name: /Copiar pendentes/ }).click();
    const copiado = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(copiado.includes('Ana') === false && copiado.includes('Daniela Rocha Pires'), 'texto de pendentes para WhatsApp');
    await page.screenshot({ path: path.join(SHOTS, '06-equipe.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Avaliar liderados' }).click();
    await page.getByRole('heading', { name: /liderados avaliados/ }).waitFor();
    ok((await page.locator('.lista .linha-pessoa .chip.ok').count()) === 3, '3 já avaliados no ciclo');
    await page.getByRole('button', { name: 'Avaliar' }).first().click();
    await page.getByRole('heading', { level: 1 }).filter({ hasText: /Ana Beatriz/ }).waitFor();
    ok(await page.locator('#dataF').inputValue() !== '', 'data do feedback vem preenchida');
    await page.getByRole('button', { name: '+3 meses' }).click();
    ok((await page.locator('#dataR').inputValue()).length === 10, 'reavaliação +3 meses');
    await notasTodas(page, (i) => (i < 5 ? 5 : 3));
    await page.getByRole('button', { name: 'Adicionar observação' }).nth(1).click();
    await page.locator('#obs-LD02').fill('Chegar 10 min antes para o check-list.');
    ok((await page.locator('.progresso').innerText()).includes('4,0'), 'média ao vivo 4,0');
    await page.screenshot({ path: path.join(SHOTS, '07-form-liderado.png'), fullPage: false });
    await page.getByRole('button', { name: 'Salvar e ir para o próximo' }).click();
    await page.getByRole('heading', { level: 1 }).filter({ hasText: /Bruno/ }).waitFor();
    ok(true, 'foi para o próximo pendente (Bruno)');
    await page.getByRole('button', { name: 'Minha equipe' }).click();
    await page.getByRole('heading', { name: /liderados avaliados/ }).waitFor();
    ok((await page.locator('.lista .linha-pessoa .chip.ok').count()) === 4, 'agora 4 avaliados');
    await page.getByRole('button', { name: 'Início', exact: true }).click();
    await page.getByRole('button', { name: 'Ver resultado' }).click();
    await page.getByRole('heading', { name: 'Como a equipe me avaliou' }).waitFor();
    await page.getByText(/aparecem depois que a coordenação encerrar/).waitFor();
    ok(true, 'resultado do ciclo atual oculto');
    await page.locator('#selCiclo').selectOption('2026-1');
    await page.locator('.res-item').first().waitFor();
    ok((await page.locator('.res-item').count()) === 13, 'resultado 2026-1 com 13 itens');
    await page.screenshot({ path: path.join(SHOTS, '08-resultado-supervisor.png'), fullPage: true });
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
    const linhas = await page.locator('tbody tr').count();
    ok(linhas === 4, '4 líderes na visão geral (3 supervisores + coordenação)');
    await page.screenshot({ path: path.join(SHOTS, '09-painel.png'), fullPage: true });
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
    await page.getByText(/aparecem depois que a coordenação encerrar/).waitFor();
    ok(true, 'resultado atual oculto para gestão');
    await page.locator('#selCiclo').selectOption('2026-1');
    await page.locator('.res-item').first().waitFor();
    await page.locator('#selLider').selectOption('9001');
    await page.getByRole('heading', { name: 'Pontos fortes' }).waitFor();
    ok(true, 'resultado da coordenação mostra pontos fortes/fracos');
    await page.screenshot({ path: path.join(SHOTS, '10-resultado-coord.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Líder x Liderado' }).click();
    await page.locator('#fLL').waitFor();
    await page.locator('tbody tr').first().click();
    await page.getByRole('dialog').waitFor();
    ok((await page.getByRole('dialog').locator('.res-item').count()) === 10, 'detalhe com 10 itens');
    await page.keyboard.press('Escape');
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
    // importação de uma planilha .xlsx no formato da base (dados fictícios)
    {
      const total = baseFicticia().total;
      await page.getByRole('button', { name: /Importar base/ }).click();
      await page.locator('#arqBase').setInputFiles(BASE_TESTE);
      await page.getByText('linhas lidas').waitFor({ timeout: 15000 });
      const txt = (await page.getByRole('dialog').innerText()).replace(/\n/g, ' ');
      ok(new RegExp(total + '\\s*linhas lidas').test(txt), 'importação lê as ' + total + ' linhas do .xlsx');
      ok(txt.includes('Supervisor Alfa Santos') && txt.includes('Sem cadastro'), 'lista líderes e aponta quem está sem cadastro');
      await page.screenshot({ path: path.join(SHOTS, '11-importacao.png'), fullPage: false });
      await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    }
    await page.getByRole('tab', { name: 'Fases e ciclo' }).click();
    await page.locator('.interruptor').first().waitFor();
    await page.locator('.interruptor').first().getByRole('button', { name: 'Fechada' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar avaliação' }).click();
    await page.getByText('Avaliação do líder fechada.').waitFor();
    await page.getByRole('button', { name: 'Liberar resultado' }).click();
    await page.getByText('Resultado liberado para os líderes.').waitFor();
    ok(true, 'fase 1 fechada e resultado liberado');
    await page.screenshot({ path: path.join(SHOTS, '12-config.png'), fullPage: true });
    await page.getByRole('tab', { name: 'Visão geral' }).click();
    await page.locator('.nota-pill').first().waitFor();
    ok((await page.locator('.nota-pill').count()) >= 3, 'médias aparecem após fechar a fase');
    await page.getByRole('button', { name: 'Exportar respostas anônimas' }).count();
    await page.getByRole('tab', { name: 'Liderado x Líder' }).click();
    await page.locator('.res-item').first().waitFor();
    await page.getByRole('button', { name: 'Exportar respostas anônimas' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Copiar tabela' }).click();
    const tabela = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok(tabela.split('\n')[0].startsWith('Ciclo\tLíder avaliado'), 'exportação copiada com cabeçalho');
    ok(page.erros.length === 0, 'sem erros no console: ' + page.erros.join(' | '));
    await ctx.close();
  }

  console.log('RH e tema escuro');
  {
    const { ctx, page } = await novaPagina(browser, { dark: true });
    await page.goto(URL);
    await entrar(page, 'RH');
    const cards = await page.locator('.card-acao h2').allInnerTexts();
    ok(cards.join('|') === 'Avaliar meu líder|Painel de gestão', 'cards do RH: ' + cards.join('|'));
    await page.screenshot({ path: path.join(SHOTS, '13-rh-escuro.png'), fullPage: true });
    await sair(page);
    await entrar(page, 'Supervisor');
    await page.getByRole('button', { name: 'Ver resultado' }).click();
    await page.locator('.res-item').first().waitFor();
    await page.screenshot({ path: path.join(SHOTS, '14-resultado-escuro.png'), fullPage: true });
    ok((await page.locator('.res-item').count()) === 13, 'supervisor vê resultado atual depois de liberado');
    ok(page.erros.length === 0, 'sem erros no console: ' + page.erros.join(' | '));
    await ctx.close();
  }

  console.log('Aplicativo oficial (GitHub Pages → Apps Script por fetch)');
  {
    const API = 'https://script.google.com/macros/s/TESTE/exec';
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
    ok(await page.getByRole('link', { name: 'Ver a demonstração' }).isVisible(), 'sem endereço do Apps Script: aviso e link da demonstração');
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
    ok(store.listParticipacao().length === 1 && store.listUp().length === 1, 'resposta chegou ao servidor por fetch');
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
