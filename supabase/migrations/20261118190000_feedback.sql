-- Feedback Semestral · banco de dados no Supabase
-- Quem lê e grava é SOMENTE a função "feedback" (conexão direta com o Postgres).
-- Todas as tabelas têm RLS ligado e nenhuma política: a API pública do Supabase
-- (chaves anon/publishable) não consegue ler nem gravar nada aqui.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pessoas (
  mat text primary key,
  nome text not null,
  cc text not null default '',
  lider_mat text not null default '',
  lider_nome text not null default '',
  perfil text not null default 'COLABORADOR' check (perfil in ('COLABORADOR', 'RH', 'COORDENACAO')),
  ativo boolean not null default true,
  cpf_hash text not null default '',          -- SHA-256 de segredo + matrícula + CPF; o CPF nunca é gravado
  atualizado_em text not null default ''
);

create table if not exists public.criterios (
  id text primary key,
  form text not null check (form in ('LIDERADO_LIDER', 'LIDER_LIDERADO')),
  ordem integer not null default 0,
  texto text not null,
  ativo boolean not null default true
);

create table if not exists public.config (
  chave text primary key,
  valor jsonb not null
);

-- Quem já avaliou o líder. A chave primária impede envio duplicado.
create table if not exists public.participacao (
  ciclo text not null,
  form text not null,
  avaliador text not null,
  avaliador_nome text not null default '',
  avaliado text not null default '',
  avaliado_nome text not null default '',
  data text not null default '',
  primary key (ciclo, form, avaliador)
);

-- Avaliações que a equipe faz do líder (identificadas: o líder vê quem respondeu depois que a coordenação libera).
create table if not exists public.resp_lider (
  id text primary key,
  ciclo text not null,
  avaliado text not null,
  avaliado_nome text not null default '',
  avaliador text not null default '',
  avaliador_nome text not null default '',
  data text not null default '',
  media numeric,
  notas jsonb not null default '{}'::jsonb,
  porques jsonb not null default '{}'::jsonb,   -- "por quê" de cada nota
  fortes jsonb not null default '[]'::jsonb,
  fracos jsonb not null default '[]'::jsonb,
  consideracoes text not null default ''
);
create index if not exists resp_lider_ciclo on public.resp_lider (ciclo, avaliado);

-- Avaliações que o líder faz de cada liderado. tipo LIDERANCA = gestor avaliando um líder (itens de liderança + fortes e fracos).
create table if not exists public.resp_liderado (
  id text primary key,
  ciclo text not null,
  tipo text not null default 'PADRAO' check (tipo in ('PADRAO', 'LIDERANCA')),
  avaliador text not null,
  avaliador_nome text not null default '',
  avaliado text not null,
  avaliado_nome text not null default '',
  data_feedback text not null default '',
  data_reavaliacao text not null default '',
  media numeric,
  notas jsonb not null default '{}'::jsonb,
  obs jsonb not null default '{}'::jsonb,        -- "por quê" de cada nota
  fortes jsonb not null default '[]'::jsonb,
  fracos jsonb not null default '[]'::jsonb,
  plano jsonb not null default '[]'::jsonb,      -- combinados para a próxima conversa
  consideracoes text not null default '',
  modalidade text not null default '',           -- PRESENCIAL ou ONLINE, preenchida quando a conversa é registrada
  ciencia_em text not null default '',           -- quando o liderado confirmou que conversou com o líder
  enviado_em text not null default '',
  atualizado_em text not null default '',
  unique (ciclo, avaliador, avaliado)
);

-- Cronograma de feedback: o líder marca o dia de cada conversa; RH e coordenação acompanham.
create table if not exists public.agenda (
  id text primary key,
  ciclo text not null,
  lider text not null,
  liderado text not null,
  data text not null,
  tipo text not null default 'FEEDBACK' check (tipo in ('FEEDBACK', 'ACOMPANHAMENTO')),
  status text not null default 'AGENDADO' check (status in ('AGENDADO', 'REALIZADO', 'CANCELADO')),
  realizado_em text not null default '',
  modalidade text not null default '',           -- PRESENCIAL ou ONLINE
  obs text not null default '',
  atualizado_em text not null default ''
);
create index if not exists agenda_ciclo on public.agenda (ciclo, lider);
-- bancos criados antes da separação entre avaliação e conversa
alter table public.resp_liderado add column if not exists modalidade text not null default '';
alter table public.agenda add column if not exists modalidade text not null default '';

-- Sessões e tentativas de login. A chave é um hash: o token da sessão não fica gravado.
create table if not exists public.cache (
  chave text primary key,
  valor text not null,
  expira_em timestamptz not null
);

-- Registro de uso (sem conteúdo das avaliações).
create table if not exists public.log (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  mat text not null default '',
  evento text not null default '',
  detalhe text not null default ''
);

create table if not exists public.segredos (
  nome text primary key,
  valor text not null
);

-- Fecha tudo para a API pública: só a função "feedback" (conexão direta) acessa.
do $$
declare
  t text;
begin
  foreach t in array array['pessoas', 'criterios', 'config', 'participacao', 'resp_lider', 'resp_liderado', 'agenda', 'cache', 'log', 'segredos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$$;
revoke all on sequence public.log_id_seq from anon, authenticated;

-- Segredo do hash do CPF e código do primeiro acesso da coordenação (gerados aqui, nunca no código).
insert into public.segredos (nome, valor) values
  ('pepper', encode(extensions.gen_random_bytes(32), 'hex')),
  ('codigo_configuracao', upper(encode(extensions.gen_random_bytes(4), 'hex')))
on conflict (nome) do nothing;

insert into public.criterios (id, form, ordem, texto, ativo) values
  ('LL01', 'LIDERADO_LIDER', 1, 'Comunicação e clareza nas orientações', true),
  ('LL02', 'LIDERADO_LIDER', 2, 'Respeito e tratamento justo', true),
  ('LL03', 'LIDERADO_LIDER', 3, 'Escuta e abertura ao diálogo', true),
  ('LL04', 'LIDERADO_LIDER', 4, 'Organização e distribuição das atividades', true),
  ('LL05', 'LIDERADO_LIDER', 5, 'Apoio ao desenvolvimento da equipe', true),
  ('LL06', 'LIDERADO_LIDER', 6, 'Reconhecimento e valorização', true),
  ('LL07', 'LIDERADO_LIDER', 7, 'Resolução de conflitos', true),
  ('LL08', 'LIDERADO_LIDER', 8, 'Compromisso com a segurança', true),
  ('LL09', 'LIDERADO_LIDER', 9, 'Disponibilidade e apoio à equipe', true),
  ('LL10', 'LIDERADO_LIDER', 10, 'Contribui para o meu desenvolvimento profissional', true),
  ('LL11', 'LIDERADO_LIDER', 11, 'Tenho liberdade para conversar com meu líder quando algo não está bem', true),
  ('LL12', 'LIDERADO_LIDER', 12, 'Orienta e acompanha a equipe nos procedimentos de segurança', true),
  ('LL13', 'LIDERADO_LIDER', 13, 'É transparente, fala a verdade e transmite confiança para a equipe', true),
  ('LD01', 'LIDER_LIDERADO', 1, 'Comprometimento', true),
  ('LD02', 'LIDER_LIDERADO', 2, 'Pontualidade e assiduidade', true),
  ('LD03', 'LIDER_LIDERADO', 3, 'Responsabilidade', true),
  ('LD04', 'LIDER_LIDERADO', 4, 'Qualidade do trabalho', true),
  ('LD05', 'LIDER_LIDERADO', 5, 'Produtividade e organização', true),
  ('LD06', 'LIDER_LIDERADO', 6, 'Trabalho em equipe', true),
  ('LD07', 'LIDER_LIDERADO', 7, 'Comunicação', true),
  ('LD08', 'LIDER_LIDERADO', 8, 'Proatividade e aprendizagem', true),
  ('LD09', 'LIDER_LIDERADO', 9, 'Cumprimento de normas e procedimentos', true),
  ('LD10', 'LIDER_LIDERADO', 10, 'Segurança no trabalho', true)
on conflict (id) do nothing;

insert into public.config (chave, valor) values
  ('ciclo', '"2026-2"'::jsonb),
  ('faseLideradoLider', '"ABERTA"'::jsonb),
  ('faseLiderLiderado', '"FECHADA"'::jsonb),
  ('ciclosLiberados', '[]'::jsonb),
  ('limiteMensal', '3.5'::jsonb),
  ('notaCritica', '2'::jsonb),
  ('escala', '["Muito ruim","Ruim","Regular","Bom","Excelente"]'::jsonb),
  ('organizacao', '"Sirtec · Operação Centro-BA"'::jsonb)
on conflict (chave) do nothing;
