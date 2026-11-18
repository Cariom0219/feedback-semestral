// Monta os arquivos publicados a partir de src/:
//   apps-script/  → colar no Google Apps Script (servidor + banco na Planilha Google)
//   docs/         → site do GitHub Pages (aplicativo oficial e demonstração)
const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const ler = (f) => fs.readFileSync(path.join(raiz, 'src', f), 'utf8');
const gravar = (f, conteudo) => {
  const destino = path.join(raiz, f);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
};

const ui = ler('ui.html');
const MARCADOR = '<!--SCRIPTS_EXTRAS-->';
if (!ui.includes(MARCADOR)) throw new Error('marcador ausente em ui.html');
for (const f of ['core.js', 'store-memory.js', 'demo-seed.js']) {
  if (/<\/script/i.test(ler(f))) throw new Error(f + ' contém </script>');
}
const comExtras = (extras, titulo) => {
  let html = ui.replace(MARCADOR, () => extras);
  if (titulo) html = html.replace('<title>Feedback Semestral</title>', () => '<title>' + titulo + '</title>');
  return html;
};

// 1) Google Apps Script
gravar('apps-script/Codigo.gs', ler('core.js') + '\n\n' + ler('server.gs.js'));
gravar('apps-script/Index.html', comExtras(''));
gravar('apps-script/appsscript.json', JSON.stringify({
  timeZone: 'America/Bahia',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' }
}, null, 2) + '\n');

// 2) GitHub Pages: aplicativo oficial (fala com o Apps Script pelo endereço do config.js)
gravar('docs/index.html', comExtras('<script src="config.js"></script>'));
const config = path.join(raiz, 'docs/config.js');
if (!fs.existsSync(config)) {
  gravar('docs/config.js', [
    '// Endereço do Apps Script publicado (Implantar → App da Web). Termina em /exec.',
    '// Exemplo: window.FB_API_URL = \'https://script.google.com/macros/s/AKfy.../exec\';',
    "window.FB_API_URL = '';",
    ''
  ].join('\n'));
}
gravar('docs/.nojekyll', '');

// 3) Demonstração com dados fictícios (servidor de mentira dentro do navegador)
const scriptsDemo = '<script>\n' + ler('core.js') + '\n' + ler('store-memory.js') + '\n' + ler('demo-seed.js') + '\n</script>';
gravar('docs/demo/index.html', comExtras(scriptsDemo, 'Demonstração Feedback Semestral'));

for (const f of ['apps-script/Codigo.gs', 'apps-script/Index.html', 'docs/index.html', 'docs/config.js', 'docs/demo/index.html']) {
  console.log(f.padEnd(26), (fs.statSync(path.join(raiz, f)).size / 1024).toFixed(1) + ' KB');
}
