# Feedback Semestral

Ferramenta de feedback semestral da Operação Centro-BA (Sirtec) com duas avaliações:

- **Liderado x Líder** (anônima): cada colaborador avalia o próprio líder com notas de 1 a 5 e considerações finais. Quem é liderado direto da coordenação também escreve 3 pontos fortes e 3 pontos fracos.
- **Líder x Liderado** (identificada): o líder avalia cada liderado com notas de 1 a 5, data do feedback, data da reavaliação e observações.

A pessoa entra com a **matrícula**, confirma o nome e usa o **CPF como senha**. Coordenação e RH têm um painel de gestão. Os líderes veem quem já respondeu, mas não o que cada pessoa respondeu.

- Aplicativo: https://cariom0219.github.io/feedback-semestral/
- Demonstração com dados fictícios: https://cariom0219.github.io/feedback-semestral/demo/

## Como funciona

```
Celular / computador
        │
        ▼
GitHub Pages (pasta docs/)         ← só as telas
        │  fetch (POST)
        ▼
Google Apps Script (apps-script/)  ← regras, login e permissões
        │
        ▼
Planilha Google                    ← banco de dados (abas Pessoas, Respostas, etc.)
```

O GitHub só hospeda as telas. As respostas ficam numa Planilha Google da coordenação, gravadas pelo Apps Script. O endereço do Apps Script fica em `docs/config.js`.

O link do próprio Apps Script (terminado em `/exec`) também abre o aplicativo completo, sem o GitHub.

## Colocar no ar (uma vez)

1. **Crie uma Planilha Google** na conta que vai guardar os dados.
2. Na planilha, abra **Extensões → Apps Script**. Apague o conteúdo do `Código.gs` e cole o [`apps-script/Codigo.gs`](apps-script/Codigo.gs). Clique em **+ → HTML**, dê o nome `Index` e cole o [`apps-script/Index.html`](apps-script/Index.html). Salve.
3. Recarregue a planilha. No menu **Feedback**:
   - **1. Preparar planilha** cria as abas. Na primeira vez o Google pede autorização: Avançado → Acessar → Permitir.
   - **2. Cadastrar acesso da coordenação ou do RH**: matrícula, nome igual ao da coluna Liderança da base, CPF e perfil `COORDENACAO` ou `RH`.
4. No Apps Script: **Implantar → Nova implantação → App da Web**, com **Executar como: Eu** e **Quem pode acessar: Qualquer pessoa**. Copie o endereço que termina em `/exec`.
5. No GitHub, edite [`docs/config.js`](docs/config.js) e cole o endereço:
   ```js
   window.FB_API_URL = 'https://script.google.com/macros/s/.../exec';
   ```
   Em cerca de 1 minuto o site passa a funcionar.
6. Entre no site com a sua matrícula e vá em **Painel de gestão → Pessoas → Importar base** para carregar a planilha de colaboradores (colunas Matrícula, Descrição C.C, Liderança, Nome e CPF).

Se a conta Google da empresa não mostrar a opção "Qualquer pessoa", use uma conta Gmail separada só para o feedback.

**Atualizar o código depois:** cole os arquivos novos no Apps Script e use **Implantar → Gerenciar implantações → Editar → Nova versão**. Assim o endereço `/exec` continua o mesmo.

## Segurança e anonimato

- O CPF nunca fica em texto: é guardado como SHA-256 de uma chave secreta (nas propriedades do script) + matrícula + CPF. Depois de 5 tentativas erradas o acesso trava por 15 minutos.
- "Quem respondeu" (aba Participacao) e "o que respondeu" (aba Resp_LideradoLider) ficam separados. A resposta anônima não tem nome nem data e entra na planilha em lotes embaralhados de 5.
- Resultados da avaliação do líder só aparecem depois que a coordenação fecha a fase e com no mínimo 3 respostas (configurável). Cada líder só vê o próprio resultado quando a coordenação libera.
- Todas as regras rodam no servidor (Apps Script). A página nunca recebe CPF nem respostas de outras pessoas.
- Este repositório não contém dados reais. Nunca envie a base de colaboradores para cá (o `.gitignore` bloqueia `*.xlsx`, `tmp/` e `*.local.*`).

## Abas da planilha

| Aba | Conteúdo |
| --- | --- |
| Pessoas | Matrícula, nome, C.C, UTD, líder, perfil, ativo e CPF criptografado |
| Criterios | Itens dos dois formulários (editáveis no painel) |
| Participacao | Quem já avaliou o líder e em que dia |
| Resp_LideradoLider | Notas e comentários anônimos |
| Resp_LiderLiderado | Avaliações dos líderes, identificadas |
| Config | Ciclo atual, fases abertas/fechadas e liberação de resultados |
| Log | Acessos e alterações (sem conteúdo das avaliações) |
| Importar | Área para colar a base e importar pelo menu |

## Desenvolvimento

```
src/core.js           regras (usadas no Apps Script e na demonstração)
src/server.gs.js      servidor Apps Script: Planilha, sessão, menu, doGet/doPost
src/ui.html           telas (JavaScript puro, sem framework)
src/store-memory.js   armazenamento em memória (demonstração e testes)
src/demo-seed.js      dados fictícios da demonstração
build.js              gera apps-script/ e docs/
test/                 testes (somente dados fictícios)
```

```bash
npm install
npm run build      # gera apps-script/ e docs/ a partir de src/
npm test           # regras + simulador do Apps Script
npm run test:ui    # navegador (Playwright): demonstração e site oficial
```

Edite sempre os arquivos de `src/` e rode `npm run build`. Os arquivos de `apps-script/` e `docs/` são gerados, exceto `docs/config.js`, que o build não sobrescreve.
