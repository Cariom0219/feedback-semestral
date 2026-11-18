// Monta os arquivos publicados a partir de src/:
//   docs/      → site do GitHub Pages (aplicativo oficial e demonstração)
//   supabase/  → função "feedback" e banco de dados no Supabase
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

// 1) GitHub Pages: aplicativo oficial (fala com a função do Supabase pelo endereço do config.js)
gravar('docs/index.html', comExtras('<script src="config.js"></script>'));
const config = path.join(raiz, 'docs/config.js');
if (!fs.existsSync(config)) {
  gravar('docs/config.js', [
    '// Endereço da função "feedback" do Supabase.',
    '// Exemplo: window.FB_API_URL = \'https://SEU-PROJETO.supabase.co/functions/v1/feedback\';',
    "window.FB_API_URL = '';",
    ''
  ].join('\n'));
}
gravar('docs/.nojekyll', '');

// 2) Demonstração com dados fictícios (servidor de mentira dentro do navegador)
const scriptsDemo = '<script>\n' + ler('core.js') + '\n' + ler('store-memory.js') + '\n' + ler('demo-seed.js') + '\n</script>';
gravar('docs/demo/index.html', comExtras(scriptsDemo, 'Demonstração Feedback Semestral'));

// 3) Supabase: função "feedback". O código das regras fica em servidor.js (módulo ES);
//    index.ts só liga o servidor ao Deno.serve com a biblioteca do Postgres.
const codigoServidor = [ler('core.js'), ler('store-memory.js'), ler('server.supabase.js')].join('\n')
  .replace(/^if \(typeof module !== 'undefined' && module\.exports\).*$/gm, ''); // no Deno não existe module.exports
gravar('supabase/functions/feedback/servidor.js', [
  '// Gerado por build.js a partir de src/core.js, src/store-memory.js e src/server.supabase.js. Não edite aqui.',
  'var postgres = null;',
  codigoServidor,
  'export function iniciar(biblioteca) { postgres = biblioteca; return tratarPedido; }',
  ''
].join('\n'));
gravar('supabase/functions/feedback/index.ts', [
  '// Função "feedback" do Feedback Semestral (Supabase Edge Function, sem verificação de JWT).',
  '// Publicar: supabase functions deploy feedback --no-verify-jwt',
  "import postgres from 'npm:postgres@3.4.5';",
  "import { iniciar } from './servidor.js';",
  '',
  'Deno.serve(iniciar(postgres));',
  ''
].join('\n'));

const Core = require('./src/core.js');
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const seedCriterios = Core.CRITERIOS_PADRAO.map((c) => `  (${q(c.id)}, ${q(c.form)}, ${c.ordem}, ${q(c.texto)}, true)`).join(',\n');
const seedConfig = Object.keys(Core.CONFIG_PADRAO).map((k) => `  (${q(k)}, ${q(JSON.stringify(Core.CONFIG_PADRAO[k]))}::jsonb)`).join(',\n');
gravar('supabase/migrations/20261118190000_feedback.sql', ler('schema.sql')
  .replace('-- SEED_CRITERIOS', () => seedCriterios)
  .replace('-- SEED_CONFIG', () => seedConfig));

for (const f of ['docs/index.html', 'docs/config.js', 'docs/demo/index.html',
  'supabase/functions/feedback/index.ts', 'supabase/functions/feedback/servidor.js', 'supabase/migrations/20261118190000_feedback.sql']) {
  console.log(f.padEnd(26), (fs.statSync(path.join(raiz, f)).size / 1024).toFixed(1) + ' KB');
}
