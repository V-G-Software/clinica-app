// Administração da plataforma (14.7): cria ou atualiza uma organização a partir de um arquivo no formato
// dos cenários (contrato/exemplos/cenarios/*.json): organização, primeiro gestor e equipe, módulos, termos,
// marca, formulários e pacientes de exemplo. Roda como clinica_dono, com o contexto da organização (RLS forçado).
//   pnpm org:criar --arquivo ../contrato/exemplos/cenarios/modelo-otorrino.json
//   pnpm org:criar --todos           (os 3 cenários)
//   pnpm org:atualizar --arquivo org.json   (só configuração: marca, módulos, termos, textos)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.ts';
import { cifrar, hashSenha, sha256 } from '../src/cripto.ts';
import { normalizar } from '@clinica/dominio';
import { migrar } from './migrar.ts';

const CENARIOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contrato/exemplos/cenarios');
const [acao, ...args] = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

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
      configuracao(o), cen.termos, JSON.stringify(cen.modulos), cen.capacidades]);
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
    await c.query('COMMIT');
    log(`organização criada: ${o.slug} → ${urlApi} (${cen.usuarios.length} contas, ${(cen.pacientes ?? []).length} pacientes)`);
  } catch (e) { await c.query('ROLLBACK'); throw e; }
}
async function atualizar(c: pg.Client, cen: any) {
  const o = cen.organizacao;
  const r = await c.query('UPDATE organizacoes SET nome = $2, fuso = $3, locale = $4, status = $5, mensagem_status = $6, dominios = $7, configuracao = $8, termos = $9, modulos = $10, capacidades = $11, versao = versao + 1 WHERE slug = $1',
    [o.slug, o.nome, o.fuso, o.locale, o.status, o.mensagemStatus, o.dominios ?? [], configuracao(o), cen.termos, JSON.stringify(cen.modulos), cen.capacidades]);
  console.log(r.rowCount ? `organização atualizada: ${o.slug}` : `organização não encontrada: ${o.slug}`);
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
      if (acao === 'criar') await criarOrganizacao(c, cen); else await atualizar(c, cen);
    }
  } finally { await c.end(); }
}
