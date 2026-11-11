// Administração da plataforma (14.7): cria ou atualiza uma organização a partir de um arquivo no formato
// dos cenários (contrato/exemplos/cenarios/*.json): organização, primeiro gestor e equipe, módulos, termos,
// marca, formulários, pacientes, protocolos, acompanhamentos e conversas de exemplo. Roda como clinica_dono, com o contexto da organização (RLS forçado).
//   pnpm org:criar --arquivo ../contrato/exemplos/cenarios/modelo-otorrino.json
//   pnpm org:criar --todos           (os 3 cenários)
//   pnpm org:atualizar --arquivo org.json [--aviso "o que mudou"]   (só configuração: marca, módulos, termos, textos;
//        termos com versão nova avisam todas as contas ativas — QUESTION-014)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.ts';
import { cifrar, hashSenha, sha256 } from '../src/cripto.ts';
import { normalizar } from '@clinica/dominio';
import { migrar } from './migrar.ts';
import { notificar } from '../src/servicos/notificar.ts';
import { semearF2 } from './semear-f2.ts';

const CENARIOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contrato/exemplos/cenarios');
const [acao, ...args] = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

/** Módulos que este backend implementa. Os demais do cenário (ex.: `agenda`, F4) ficam de fora até a etapa do backend. */
export const MODULOS_IMPLEMENTADOS = new Set(['pacientes', 'acompanhamento', 'chat', 'equipe', 'agenda', 'exames', 'documentos']);
function modulosSuportados(cen: any, log: (m: string) => void = console.log) {
  const fora = cen.modulos.filter((m: any) => !MODULOS_IMPLEMENTADOS.has(m.id)).map((m: any) => m.id);
  if (fora.length) log(`aviso: ${cen.organizacao.slug}: módulo(s) ${fora.join(', ')} ainda não implementado(s) neste backend — ignorado(s)`);
  return JSON.stringify(cen.modulos.filter((m: any) => MODULOS_IMPLEMENTADOS.has(m.id)));
}
function configuracao(o: any) {
  return { contato: o.contato, tema: o.tema, pwa: o.pwa, autenticacao: o.autenticacao, textos: o.textos, links: o.links, mapaUrl: o.mapaUrl ?? null };
}

export async function criarOrganizacao(c: pg.Client, cen: any, log = console.log) {
  const o = cen.organizacao;
  const urlApi = `${config.urlPublica}/o/${o.slug}`;
  await c.query('BEGIN');
  try {
    await c.query(`INSERT INTO organizacoes (id, slug, nome, fuso, locale, status, mensagem_status, dominios, url_api, configuracao, termos, modulos, capacidades)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [o.id, o.slug, o.nome, o.fuso, o.locale, o.status, o.mensagemStatus, o.dominios ?? [], urlApi,
      configuracao(o), cen.termos, modulosSuportados(cen, log), cen.capacidades]);
    await c.query("SELECT set_config('app.organizacao_id', $1, true)", [o.id]);
    const termos = o.autenticacao.termosVersao;
    for (const f of cen.formularios ?? [])
      await c.query('INSERT INTO formularios (organizacao_id, id, versao, titulo, finalidade, campos) VALUES ($1,$2,$3,$4,$5,$6)', [o.id, f.id, f.versao, f.titulo, f.finalidade, JSON.stringify(f.campos)]);
    for (const p of cen.pacientes ?? [])
      await c.query(`INSERT INTO pacientes (organizacao_id, id, tipo, nome, nome_social, data_nascimento, contato, campos_adicionais, responsaveis, nome_busca, criado_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [o.id, p.id, p.tipo, p.nome, p.nomeSocial ?? null, p.dataNascimento ?? null, p.contato ?? {}, p.camposAdicionais ?? {},
        JSON.stringify(p.responsaveis ?? []), normalizar(p.nome), p.criadoEm ?? new Date()]);
    for (const u of cen.usuarios) {
      const equipe = u.perfis.some((x: string) => x !== 'PACIENTE');
      await c.query(`INSERT INTO usuarios (organizacao_id, id, email, nome, nome_exibicao, senha_hash, perfis, status, mfa_segredo_cifrado, codigos_recuperacao_hash,
          trocar_senha, termos_aceitos_versao, rotulos_perfis, profissional) VALUES ($1,$2,$3,$4,$5,$6,$7,'ATIVO',$8,$9,$10,$11,$12,$13)`,
        [o.id, u.id, u.email, u.nome, u.nomeExibicao ?? u.nome, u.senha ? await hashSenha(u.senha) : null, u.perfis, u.mfaSegredo ? cifrar(u.mfaSegredo) : null,
          u.mfaSegredo ? ['RECUPERA-0001', 'RECUPERA-0002', 'RECUPERA-0003'].map((r) => sha256(`${u.id}|${r}`)) : [],
          !!u.trocarSenha, u.termosAceitos === false ? null : termos, u.rotulosPerfis ?? {}, u.profissional ?? null]);
      for (const v of u.vinculos ?? []) await c.query('INSERT INTO vinculos (organizacao_id, usuario_id, paciente_id, relacao) VALUES ($1,$2,$3,$4)', [o.id, u.id, v.pacienteId, v.relacao]);
      void equipe;
    }
    for (const p of cen.pacientes ?? []) if (p.convite)
      await c.query(`INSERT INTO convites (organizacao_id, id, token_hash, tipo, paciente_id, email, relacao, nome, nome_conta, criado_por, expira_em)
        VALUES ($1,$2,$3,'PACIENTE',$4,$5,$6,$7,$7,$8, now() + interval '7 days')`, [o.id, `cnt_${p.id}`, sha256(p.convite.token), p.id,
        p.contato?.email ?? p.responsaveis?.[0]?.contato?.email ?? null, p.tipo === 'ANIMAL' ? 'ANIMAL' : 'PROPRIO', p.nome, p.convite.criadoPor ?? null]);
    await semearF2(c, { id: o.id, slug: o.slug, nome: o.nome, fuso: o.fuso, locale: o.locale, status: o.status, mensagemStatus: o.mensagemStatus ?? null,
      dominios: o.dominios ?? [], urlApi, configuracao: configuracao(o), termos: cen.termos, modulos: cen.modulos, capacidades: cen.capacidades, versao: 1 }, cen);
    await c.query('COMMIT');
    log(`organização criada: ${o.slug} → ${urlApi} (${cen.usuarios.length} contas, ${(cen.pacientes ?? []).length} pacientes)`);
  } catch (e) { await c.query('ROLLBACK'); throw e; }
}
/**
 * Atualiza a configuração. Se `autenticacao.termosVersao` mudou (QUESTION-014): o aceite continua no próximo
 * login (etapa ACEITAR_TERMOS), e toda conta ativa recebe agora uma notificação SISTEMA (central + push discreto)
 * avisando da mudança. `aviso` substitui o texto padrão (ex.: resumo do que mudou, escrito pela clínica).
 */
export async function atualizarOrganizacao(c: pg.Client, cen: any, opcoes: { aviso?: string; log?: (m: string) => void } = {}) {
  const log = opcoes.log ?? console.log;
  const o = cen.organizacao;
  await c.query('BEGIN');
  try {
    const antes = (await c.query(`SELECT id, configuracao->'autenticacao'->>'termosVersao' AS termos FROM organizacoes WHERE slug = $1 FOR UPDATE`, [o.slug])).rows[0];
    if (!antes) { await c.query('ROLLBACK'); log(`organização não encontrada: ${o.slug}`); return { avisados: 0 }; }
    const r = (await c.query('UPDATE organizacoes SET nome = $2, fuso = $3, locale = $4, status = $5, mensagem_status = $6, dominios = $7, configuracao = $8, termos = $9, modulos = $10, capacidades = $11, versao = versao + 1 WHERE slug = $1 RETURNING *',
      [o.slug, o.nome, o.fuso, o.locale, o.status, o.mensagemStatus, o.dominios ?? [], configuracao(o), cen.termos, modulosSuportados(cen, log), cen.capacidades])).rows[0];
    let avisados = 0;
    if (antes.termos !== o.autenticacao.termosVersao) {
      await c.query("SELECT set_config('app.organizacao_id', $1, true)", [r.id]);
      const org = { id: r.id, slug: r.slug, nome: r.nome, fuso: r.fuso, locale: r.locale, status: r.status, mensagemStatus: r.mensagem_status, dominios: r.dominios,
        urlApi: r.url_api, configuracao: r.configuracao, termos: r.termos, modulos: r.modulos, capacidades: r.capacidades, versao: r.versao };
      const texto = opcoes.aviso ?? `${r.nome} atualizou os termos de uso e a política de privacidade. Você vai ler e confirmar no próximo acesso ao app.`;
      const contas = (await c.query(`SELECT id FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO' AND termos_aceitos_versao IS DISTINCT FROM $2`, [r.id, o.autenticacao.termosVersao])).rows;
      const silencioso = { info: () => undefined };
      for (const u of contas) await notificar(c as any, org as any, u.id, { tipo: 'SISTEMA', titulo: 'Termos de uso atualizados', texto, destino: { tela: 'perfil' } }, silencioso);
      await c.query(`INSERT INTO auditoria (organizacao_id, usuario_id, acao, recurso, recurso_id, request_id) VALUES ($1, NULL, 'ATUALIZAR_TERMOS', 'organizacao', $1, $2)`,
        [r.id, `org:atualizar:${process.env.USER ?? 'operador'}`]);
      avisados = contas.length;
    }
    await c.query('COMMIT');
    log(`organização atualizada: ${o.slug}${avisados ? ` — termos ${antes.termos} → ${o.autenticacao.termosVersao}, ${avisados} conta(s) avisada(s)` : ''}`);
    return { avisados };
  } catch (e) { await c.query('ROLLBACK'); throw e; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arquivos = args.includes('--todos') ? readdirSync(CENARIOS).filter((f) => f.endsWith('.json')).map((f) => path.join(CENARIOS, f)) : [arg('--arquivo')].filter(Boolean) as string[];
  if (!arquivos.length || !['criar', 'atualizar'].includes(acao)) { console.error('uso: org.ts criar|atualizar --arquivo org.json | --todos'); process.exit(1); }
  await migrar(config.bancoDono, true);
  const c = new pg.Client({ connectionString: config.bancoDono });
  await c.connect();
  try {
    for (const a of arquivos) {
      const cen = JSON.parse(readFileSync(path.resolve(a), 'utf8'));
      if (acao === 'criar') await criarOrganizacao(c, cen); else await atualizarOrganizacao(c, cen, { aviso: arg('--aviso') });
    }
  } finally { await c.end(); }
}
