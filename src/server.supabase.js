/**
 * Feedback Semestral · servidor no Supabase (Edge Function "feedback", Deno)
 *
 * Roda exatamente as mesmas regras do núcleo (FeedbackCore) usadas no Apps Script.
 * Cada pedido abre uma transação: lê o banco, aplica as regras em memória e grava só o que mudou.
 * Pedidos que gravam passam por uma trava (pg_advisory_xact_lock), para não haver gravação duplicada.
 * O banco fica fechado para a API pública (RLS sem políticas): só esta função lê e grava.
 *
 * Pedido:   POST {acao, dados, token}  (texto JSON, sem cabeçalhos especiais)
 * Resposta: {ok: true, data} ou {ok: false, code, message}
 */

var FUSO = 'America/Bahia';
var TRAVA = 727274;
var ACOES_QUE_GRAVAM = {
  login: 1, sair: 1, enviarLider: 1, salvarLiderado: 1, salvarPessoa: 1, importar: 1,
  salvarConfig: 1, salvarCriterio: 1, configurarCoordenacao: 1, darCiencia: 1, gerarAgenda: 1, salvarAgenda: 1
};
var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400'
};

// ------------------------------------------------------------------ partes puras (testáveis sem banco)

function partesData(d, comHora) {
  var opcoes = { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' };
  if (comHora) { opcoes.hour = '2-digit'; opcoes.minute = '2-digit'; opcoes.second = '2-digit'; opcoes.hourCycle = 'h23'; }
  var p = {};
  new Intl.DateTimeFormat('en-CA', opcoes).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
  return p;
}
function hojeBahia(d) { var p = partesData(d || new Date(), false); return p.year + '-' + p.month + '-' + p.day; }
function agoraBahia(d) {
  var p = partesData(d || new Date(), true);
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second;
}

/** A tabela de cache guarda só o hash da chave: tokens de sessão nunca ficam em texto no banco. */
function hashChave(k) { return Sha256('cache|' + k); }

/** Chaves de cache que as regras podem ler neste pedido (as regras são síncronas: carregamos antes). */
function chavesDoPedido(acao, dados, token) {
  var chaves = [];
  if (token) chaves.push('s:' + token);
  if (dados && dados.mat) chaves.push('f:' + FeedbackCore.normMat(dados.mat));
  if (acao === 'configurarCoordenacao') chaves.push('cfg:tentativas');
  return chaves;
}

function numeroOuNulo(v) { return v === null || v === undefined || v === '' ? null : Number(v); }

/** Converte as linhas lidas do banco no estado usado pelas regras. */
function montarEstado(linhas, chaves) {
  var segredos = {};
  (linhas.segredos || []).forEach(function (r) { segredos[r.nome] = r.valor; });
  if (!segredos.pepper) throw new Error('Segredo do CPF ausente no banco (tabela segredos).');
  var porHash = {};
  (linhas.cache || []).forEach(function (r) { porHash[r.chave] = r; });
  var cache = {};
  (chaves || []).forEach(function (k) {
    var r = porHash[hashChave(k)];
    if (r) cache[k] = { v: String(r.valor), exp: Number(r.exp) };
  });
  var config = {};
  (linhas.config || []).forEach(function (r) { config[r.chave] = r.valor; });
  return {
    segredo: segredos.pepper,
    codigoConfiguracao: segredos.codigo_configuracao || '',
    config: config,
    pessoas: (linhas.pessoas || []).map(function (r) {
      return {
        mat: r.mat, nome: r.nome, cc: r.cc || '', liderMat: r.lider_mat || '', liderNome: r.lider_nome || '',
        perfil: r.perfil, ativo: r.ativo !== false, cpfHash: r.cpf_hash || '', atualizadoEm: r.atualizado_em || ''
      };
    }),
    criterios: (linhas.criterios || []).map(function (r) {
      return { id: r.id, form: r.form, ordem: Number(r.ordem) || 0, texto: r.texto, ativo: r.ativo !== false };
    }),
    participacao: (linhas.participacao || []).map(function (r) {
      return { ciclo: r.ciclo, form: r.form, avaliador: r.avaliador, avaliadorNome: r.avaliador_nome, avaliado: r.avaliado, avaliadoNome: r.avaliado_nome, data: r.data };
    }),
    up: (linhas.respostas || []).map(function (r) {
      return {
        id: r.id, ciclo: r.ciclo, avaliado: r.avaliado, avaliadoNome: r.avaliado_nome, avaliador: r.avaliador || '', avaliadorNome: r.avaliador_nome || '',
        data: r.data || '', media: numeroOuNulo(r.media), notas: r.notas || {}, porques: r.porques || {},
        fortes: r.fortes || [], fracos: r.fracos || [], consideracoes: r.consideracoes || ''
      };
    }),
    down: (linhas.liderados || []).map(function (r) {
      return {
        id: r.id, ciclo: r.ciclo, tipo: r.tipo || 'PADRAO', avaliador: r.avaliador, avaliadorNome: r.avaliador_nome, avaliado: r.avaliado,
        avaliadoNome: r.avaliado_nome, dataFeedback: r.data_feedback, dataReavaliacao: r.data_reavaliacao, media: numeroOuNulo(r.media),
        notas: r.notas || {}, obs: r.obs || {}, fortes: r.fortes || [], fracos: r.fracos || [], plano: r.plano || [],
        consideracoes: r.consideracoes || '', cienciaEm: r.ciencia_em || '', enviadoEm: r.enviado_em || '', atualizadoEm: r.atualizado_em || ''
      };
    }),
    agenda: (linhas.agenda || []).map(function (r) {
      return {
        id: r.id, ciclo: r.ciclo, lider: r.lider, liderado: r.liderado, data: r.data, tipo: r.tipo, status: r.status,
        realizadoEm: r.realizado_em || '', obs: r.obs || '', atualizadoEm: r.atualizado_em || ''
      };
    }),
    logs: [],
    cache: cache
  };
}

/** Armazenamento em memória que anota cada gravação, para depois repetir no banco. */
function lojaRegistrada(estado, ops, relogio) {
  var base = MemoryStore(estado, relogio ? { relogio: relogio } : {});
  var loja = Object.assign({}, base);
  loja.setConfig = function (o) { base.setConfig(o); ops.push({ tipo: 'config', dados: o }); };
  loja.salvarPessoa = function (p) { base.salvarPessoa(p); ops.push({ tipo: 'pessoa', dados: p }); };
  loja.substituirPessoas = function (l) { base.substituirPessoas(l); ops.push({ tipo: 'pessoas', dados: l }); };
  loja.salvarCriterios = function (l) { base.salvarCriterios(l); ops.push({ tipo: 'criterios', dados: l }); };
  loja.addParticipacao = function (r) { base.addParticipacao(r); ops.push({ tipo: 'participacao', dados: r }); };
  loja.addUp = function (r) { base.addUp(r); ops.push({ tipo: 'up', dados: r }); };
  loja.saveDown = function (r) { base.saveDown(r); ops.push({ tipo: 'down', dados: r }); };
  loja.salvarAgenda = function (r) { base.salvarAgenda(r); ops.push({ tipo: 'agenda', dados: r }); };
  loja.log = function (mat, evento, detalhe) { ops.push({ tipo: 'log', dados: { mat: mat || '', evento: evento || '', detalhe: String(detalhe || '').slice(0, 300) } }); };
  loja.cachePut = function (k, v, seg) { base.cachePut(k, v, seg); ops.push({ tipo: 'cachePut', chave: k, valor: String(v), seg: Math.max(1, Math.floor(seg)) }); };
  loja.cacheDel = function (k) { base.cacheDel(k); ops.push({ tipo: 'cacheDel', chave: k }); };
  loja.codigoConfiguracao = function () { return estado.codigoConfiguracao || ''; };
  loja.hoje = function () { return hojeBahia(relogio ? relogio() : new Date()); };
  loja.agora = function () { return agoraBahia(relogio ? relogio() : new Date()); };
  loja.erro = function (e) { console.error(e && e.stack ? e.stack : e); };
  return loja;
}

/** Participação vai primeiro: a chave primária do banco barra envio duplicado ao mesmo tempo. */
function ordenarOps(ops) {
  return ops.filter(function (o) { return o.tipo === 'participacao'; }).concat(ops.filter(function (o) { return o.tipo !== 'participacao'; }));
}

function linhaPessoa(p) {
  return {
    mat: p.mat, nome: p.nome, cc: p.cc || '', lider_mat: p.liderMat || '', lider_nome: p.liderNome || '',
    perfil: p.perfil || 'COLABORADOR', ativo: p.ativo !== false, cpf_hash: p.cpfHash || '', atualizado_em: p.atualizadoEm || ''
  };
}

/** Executa um pedido inteiro sobre um "repositório" (banco real ou falso nos testes). */
async function executarPedido(repo, corpo, relogio) {
  var acao = String((corpo && corpo.acao) || '');
  var dados = corpo && corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
  var token = corpo && typeof corpo.token === 'string' ? corpo.token : '';
  var chaves = chavesDoPedido(acao, dados, token);
  try {
    return await repo.transacao(!!ACOES_QUE_GRAVAM[acao], async function (tx) {
      var linhas = await tx.ler(chaves.map(hashChave));
      var estado = montarEstado(linhas, chaves);
      var ops = [];
      var resposta = FeedbackCore.handle(lojaRegistrada(estado, ops, relogio), acao, dados, token);
      await tx.gravar(ordenarOps(ops));
      return resposta;
    });
  } catch (e) {
    if (e && e.codigoFeedback === 'JA_ENVIADA') {
      return { ok: false, code: 'JA_ENVIADA', message: 'Você já enviou a avaliação do seu líder neste ciclo. Obrigado!' };
    }
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, code: 'ERRO', message: 'Erro inesperado. Tente novamente em instantes.' };
  }
}

// ------------------------------------------------------------------ banco de verdade (Postgres)

function repositorioPostgres(sql) {
  return {
    transacao: function (grava, fn) {
      return sql.begin(async function (t) {
        if (grava) await t`select pg_advisory_xact_lock(${TRAVA})`;
        return fn({
          ler: async function (hashes) {
            var r = await Promise.all([
              t`select mat, nome, cc, lider_mat, lider_nome, perfil, ativo, cpf_hash, atualizado_em from public.pessoas`,
              t`select id, form, ordem, texto, ativo from public.criterios`,
              t`select chave, valor from public.config`,
              t`select ciclo, form, avaliador, avaliador_nome, avaliado, avaliado_nome, data from public.participacao`,
              t`select id, ciclo, avaliado, avaliado_nome, avaliador, avaliador_nome, data, media, notas, porques, fortes, fracos, consideracoes
                from public.resp_lider`,
              t`select id, ciclo, lider, liderado, data, tipo, status, realizado_em, obs, atualizado_em from public.agenda`,
              t`select id, ciclo, tipo, avaliador, avaliador_nome, avaliado, avaliado_nome, data_feedback, data_reavaliacao, media, notas, obs,
                       fortes, fracos, plano, consideracoes, ciencia_em, enviado_em, atualizado_em from public.resp_liderado`,
              t`select nome, valor from public.segredos`,
              hashes.length
                ? t`select chave, valor, (extract(epoch from expira_em) * 1000)::bigint as exp from public.cache where chave in ${t(hashes)} and expira_em > now()`
                : Promise.resolve([])
            ]);
            return { pessoas: r[0], criterios: r[1], config: r[2], participacao: r[3], respostas: r[4], agenda: r[5], liderados: r[6], segredos: r[7], cache: r[8] };
          },
          gravar: async function (ops) {
            for (var i = 0; i < ops.length; i++) {
              var op = ops[i], d = op.dados;
              if (op.tipo === 'participacao') {
                var ins = await t`insert into public.participacao (ciclo, form, avaliador, avaliador_nome, avaliado, avaliado_nome, data)
                  values (${d.ciclo}, ${d.form}, ${d.avaliador}, ${d.avaliadorNome || ''}, ${d.avaliado || ''}, ${d.avaliadoNome || ''}, ${d.data || ''})
                  on conflict do nothing returning avaliador`;
                if (!ins.length) { var e = new Error('participação duplicada'); e.codigoFeedback = 'JA_ENVIADA'; throw e; }
              } else if (op.tipo === 'up') {
                await t`insert into public.resp_lider (id, ciclo, avaliado, avaliado_nome, avaliador, avaliador_nome, data, media, notas, porques,
                         fortes, fracos, consideracoes)
                  values (${d.id}, ${d.ciclo}, ${d.avaliado}, ${d.avaliadoNome || ''}, ${d.avaliador || ''}, ${d.avaliadorNome || ''}, ${d.data || ''},
                          ${d.media}, ${t.json(d.notas || {})}, ${t.json(d.porques || {})}, ${t.json(d.fortes || [])}, ${t.json(d.fracos || [])},
                          ${d.consideracoes || ''})`;
              } else if (op.tipo === 'down') {
                await t`insert into public.resp_liderado (id, ciclo, tipo, avaliador, avaliador_nome, avaliado, avaliado_nome, data_feedback,
                         data_reavaliacao, media, notas, obs, fortes, fracos, plano, consideracoes, ciencia_em, enviado_em, atualizado_em)
                  values (${d.id}, ${d.ciclo}, ${d.tipo || 'PADRAO'}, ${d.avaliador}, ${d.avaliadorNome || ''}, ${d.avaliado}, ${d.avaliadoNome || ''},
                          ${d.dataFeedback || ''}, ${d.dataReavaliacao || ''}, ${d.media}, ${t.json(d.notas || {})}, ${t.json(d.obs || {})},
                          ${t.json(d.fortes || [])}, ${t.json(d.fracos || [])}, ${t.json(d.plano || [])}, ${d.consideracoes || ''},
                          ${d.cienciaEm || ''}, ${d.enviadoEm || ''}, ${d.atualizadoEm || ''})
                  on conflict (id) do update set tipo = excluded.tipo, data_feedback = excluded.data_feedback, data_reavaliacao = excluded.data_reavaliacao,
                    media = excluded.media, notas = excluded.notas, obs = excluded.obs, fortes = excluded.fortes, fracos = excluded.fracos,
                    plano = excluded.plano, consideracoes = excluded.consideracoes, ciencia_em = excluded.ciencia_em,
                    avaliador_nome = excluded.avaliador_nome, avaliado_nome = excluded.avaliado_nome, atualizado_em = excluded.atualizado_em`;
              } else if (op.tipo === 'agenda') {
                await t`insert into public.agenda (id, ciclo, lider, liderado, data, tipo, status, realizado_em, obs, atualizado_em)
                  values (${d.id}, ${d.ciclo}, ${d.lider}, ${d.liderado}, ${d.data}, ${d.tipo}, ${d.status}, ${d.realizadoEm || ''}, ${d.obs || ''},
                          ${d.atualizadoEm || ''})
                  on conflict (id) do update set data = excluded.data, tipo = excluded.tipo, status = excluded.status,
                    realizado_em = excluded.realizado_em, obs = excluded.obs, atualizado_em = excluded.atualizado_em`;
              } else if (op.tipo === 'pessoa') {
                await t`insert into public.pessoas ${t(linhaPessoa(d))}
                  on conflict (mat) do update set nome = excluded.nome, cc = excluded.cc, lider_mat = excluded.lider_mat, lider_nome = excluded.lider_nome,
                    perfil = excluded.perfil, ativo = excluded.ativo, cpf_hash = excluded.cpf_hash, atualizado_em = excluded.atualizado_em`;
              } else if (op.tipo === 'pessoas') {
                await t`delete from public.pessoas`;
                for (var j = 0; j < d.length; j += 500) await t`insert into public.pessoas ${t(d.slice(j, j + 500).map(linhaPessoa))}`;
              } else if (op.tipo === 'criterios') {
                await t`delete from public.criterios`;
                if (d.length) {
                  await t`insert into public.criterios ${t(d.map(function (c) {
                    return { id: c.id, form: c.form, ordem: Number(c.ordem) || 0, texto: c.texto, ativo: c.ativo !== false };
                  }))}`;
                }
              } else if (op.tipo === 'config') {
                var chavesCfg = Object.keys(d);
                for (var k = 0; k < chavesCfg.length; k++) {
                  await t`insert into public.config (chave, valor) values (${chavesCfg[k]}, ${t.json(d[chavesCfg[k]])})
                    on conflict (chave) do update set valor = excluded.valor`;
                }
              } else if (op.tipo === 'log') {
                await t`insert into public.log (mat, evento, detalhe) values (${d.mat}, ${d.evento}, ${d.detalhe})`;
              } else if (op.tipo === 'cachePut') {
                await t`insert into public.cache (chave, valor, expira_em) values (${hashChave(op.chave)}, ${op.valor}, now() + make_interval(secs => ${op.seg}::double precision))
                  on conflict (chave) do update set valor = excluded.valor, expira_em = excluded.expira_em`;
              } else if (op.tipo === 'cacheDel') {
                await t`delete from public.cache where chave = ${hashChave(op.chave)}`;
              }
            }
            if (ops.length && Math.random() < 0.1) await t`delete from public.cache where expira_em < now()`;
          }
        });
      });
    }
  };
}

function respostaJson(obj, status) {
  var h = { 'Content-Type': 'application/json; charset=utf-8' };
  Object.keys(CORS).forEach(function (k) { h[k] = CORS[k]; });
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

var conexao = null;
function banco() {
  if (!conexao) conexao = postgres(Deno.env.get('SUPABASE_DB_URL'), { prepare: false, max: 4, idle_timeout: 20, connect_timeout: 15 });
  return conexao;
}

// Atende cada pedido. Quem liga ao Deno.serve é o arquivo de entrada (supabase/functions/feedback/index.ts).
async function tratarPedido(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET') {
    // verificação de saúde (também serve para manter o projeto ativo)
    try {
      var r = await banco()`select count(*)::int as n from public.config`;
      return respostaJson({ ok: true, servico: 'feedback-semestral', config: r[0].n });
    } catch (e) {
      console.error(e);
      return respostaJson({ ok: false, code: 'BANCO' }, 503);
    }
  }
  if (req.method !== 'POST') return respostaJson({ ok: false, code: 'METODO', message: 'Use POST.' }, 405);
  var corpo;
  try {
    var texto = await req.text();
    if (texto.length > 3000000) throw new Error('pedido grande demais');
    corpo = JSON.parse(texto || '{}') || {};
  } catch (e) {
    return respostaJson({ ok: false, code: 'VALIDACAO', message: 'Pedido inválido.' });
  }
  return respostaJson(await executarPedido(repositorioPostgres(banco()), corpo));
}
