# Feedback Semestral

Ferramenta de feedback semestral da Operação Centro-BA (Sirtec), com duas avaliações identificadas:

- **Liderado x Líder**: cada pessoa avalia o próprio líder com notas de 1 a 5, o **porquê** das notas e considerações finais. Quem é liderado direto da coordenação também escreve 3 pontos fortes e 3 pontos fracos.
- **Líder x Liderado**: o líder avalia cada liderado no dia da conversa presencial, com notas, porquê, plano combinado e considerações. Supervisores e todos que respondem direto à coordenação (administrativo e RH) são avaliados com os itens de liderança e 3 pontos fortes e 3 fracos, e avaliam a coordenação do mesmo jeito.

A pessoa entra com a **matrícula**, confirma o nome e usa o **CPF como senha**. Antes de responder, lê uma orientação curta sobre a importância do feedback claro e transparente e os impactos positivos e negativos, e marca que leu. Os líderes recebem uma orientação própria antes de avaliar a equipe.

- Aplicativo: https://cariom0219.github.io/feedback-semestral/
- Demonstração com dados fictícios: https://cariom0219.github.io/feedback-semestral/demo/

## O que cada perfil vê

| Perfil | O que faz |
| --- | --- |
| Colaborador | Avalia o líder. Vê o próprio feedback (notas, porquê, plano, frequência mensal ou semestral e evolução entre ciclos) a partir do dia da conversa e confirma que a conversa aconteceu (ciência). |
| Líder | Avalia a equipe, monta o cronograma de conversas (com datas sugeridas), vê o painel com as médias da equipe e, depois que a coordenação libera, a avaliação de cada pessoa da equipe com nome e porquê. |
| Coordenação e RH | Painel com participação, resultados, avaliações, cronograma geral (feitos, marcados e atrasados), análises (itens mais fracos, mapa por líder e por equipe, comparação com o ciclo anterior, acompanhamento mensal), cadastro, importação da base, fases e regras. |

**Frequência do feedback.** Depois das notas, cada pessoa fica com **acompanhamento mensal** se a média for menor que 3,5 ou se tiver nota 1 ou 2 em algum item. Para líderes, conta também a média que a equipe deu. Os demais ficam no **semestral**. O limite e a nota crítica são ajustáveis em *Fases e ciclo*.

## Como funciona

```
Celular / computador
        │
        ▼
GitHub Pages (pasta docs/)             ← telas
        │  fetch (POST, texto simples)
        ▼
Supabase Edge Function "feedback"      ← regras, login e permissões (src/core.js)
        │  conexão direta (SUPABASE_DB_URL)
        ▼
Postgres do Supabase                   ← dados (tabelas com RLS e sem acesso pela API pública)
```

O endereço da função fica em [`docs/config.js`](docs/config.js).

## Colocar no ar (uma vez)

1. No Supabase, aplique a migração [`supabase/migrations/20261118190000_feedback.sql`](supabase/migrations/20261118190000_feedback.sql). Ela cria as tabelas, os itens padrão, a chave secreta do CPF e um **código de configuração**.
2. Publique a função [`supabase/functions/feedback/index.ts`](supabase/functions/feedback/index.ts) com o nome `feedback` e **sem verificação de JWT** (o login é feito pela própria função).
3. Em `docs/config.js`, coloque `window.FB_API_URL = 'https://SEU-PROJETO.supabase.co/functions/v1/feedback';`
4. Abra o site com `#configurar` no fim do endereço e crie o acesso da coordenação com o código de configuração (consulta: `select valor from segredos where nome = 'codigo_configuracao'`).
5. Entre com a matrícula e o CPF e vá em **Painel de gestão → Pessoas → Importar base** para carregar a planilha de colaboradores (colunas Matrícula, Descrição C.C, Liderança, Nome e CPF). Cadastre o RH em **Pessoas** com o perfil RH.

## Manter o Supabase ativo

No plano gratuito, o Supabase pausa projetos sem uso por 7 dias. A automação [`.github/workflows/manter-supabase-ativo.yml`](.github/workflows/manter-supabase-ativo.yml) acessa a função `feedback` a cada 3 dias (às 08:17 de Brasília), o que faz uma consulta no banco. Se a função não responder, a execução falha e o GitHub avisa por e-mail. Para rodar na hora: aba **Actions → Manter o Supabase ativo → Run workflow**.

## Segurança

- O CPF nunca fica em texto: é guardado como SHA-256 de uma chave secreta + matrícula + CPF. Depois de 5 tentativas erradas o acesso trava por 15 minutos. Sessões expiram em 4 horas sem uso.
- As tabelas têm RLS ligado e nenhuma política: a chave pública do Supabase não lê nem grava nada. Só a função acessa o banco.
- As avaliações da equipe são identificadas. Cada líder só vê as próprias respostas e só depois que a coordenação libera o ciclo. O liderado só vê o feedback a partir da data da conversa.
- Este repositório não contém dados reais. Nunca envie a base de colaboradores para cá (o `.gitignore` bloqueia `*.xlsx`, `*.csv`, `tmp/` e `*.local.*`).

## Desenvolvimento

```
src/core.js             regras (as mesmas na função do Supabase e na demonstração)
src/server.supabase.js  função do Supabase: transação, trava, leitura e gravação no Postgres
src/schema.sql          banco de dados (vira a migração em supabase/migrations)
src/ui.html             telas (JavaScript puro, sem framework)
src/store-memory.js     armazenamento em memória (demonstração e testes)
src/demo-seed.js        dados fictícios da demonstração
build.js                gera docs/ e supabase/
```

```
npm run build      # gera docs/ e supabase/
npm test           # regras (node:test)
npm run test:ui    # navegador (Playwright + Chrome), demonstração e site oficial
```
