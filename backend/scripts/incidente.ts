// Ferramentas do plano de incidente (docs/operacao/incidente.md). Rodam como clinica_dono, sempre com o
// contexto de UMA organização (RLS forçado vale também aqui). Toda ação fica na trilha de auditoria.
//   pnpm incidente revogar-sessoes --org modelo-otorrino [--usuario usr_x]   derruba sessões (efeito imediato)
//   pnpm incidente suspender --org modelo-otorrino [--reativar]             bloqueia/libera a organização inteira
//   pnpm incidente acessos --org modelo-otorrino --paciente pac_x [--desde 2026-11-01]
//        quem leu/alterou dados do paciente (titular pedindo, ou análise de vazamento) — CSV na saída
import pg from 'pg';
import { config } from '../src/config.ts';
import { idEvento } from '../src/eventos.ts';

const [acao, ...args] = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const tem = (n: string) => args.includes(n);
const operador = process.env.USER ?? 'operador';

async function comContexto<T>(c: pg.Client, orgId: string, fn: () => Promise<T>) {
  await c.query('BEGIN');
  try {
    await c.query("SELECT set_config('app.organizacao_id', $1, true)", [orgId]);
    const r = await fn();
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK'); throw e; }
}
const auditar = (c: pg.Client, orgId: string, a: string, recurso: string, id: string | null) =>
  c.query('INSERT INTO auditoria (organizacao_id, usuario_id, acao, recurso, recurso_id, request_id) VALUES ($1,NULL,$2,$3,$4,$5)', [orgId, a, recurso, id, `incidente:${operador}`]);

const c = new pg.Client({ connectionString: config.bancoDono });
await c.connect();
try {
  const slug = arg('--org');
  const org = slug ? (await c.query('SELECT id, slug FROM organizacoes WHERE slug = $1', [slug])).rows[0] : null;
  if (!org) throw new Error(`informe --org com um slug existente${slug ? ` (${slug} não existe)` : ''}`);

  if (acao === 'revogar-sessoes') {
    const usuario = arg('--usuario');
    const n = await comContexto(c, org.id, async () => {
      const r = await c.query(`UPDATE sessoes SET revogada_em = now(), motivo_revogacao = 'INCIDENTE'
        WHERE organizacao_id = $1 AND revogada_em IS NULL ${usuario ? 'AND usuario_id = $2' : ''} RETURNING id, usuario_id`, usuario ? [org.id, usuario] : [org.id]);
      // Avisa os apps abertos (SSE) para irem à tela de login; o próximo request já recebe 401 de qualquer jeito.
      const usuarios = [...new Set(r.rows.map((x) => x.usuario_id))];
      if (usuarios.length) {
        const ev = await c.query(`INSERT INTO eventos (organizacao_id, tipo, dados, destinatarios) VALUES ($1,'sessao.encerrada',$2,$3) RETURNING seq, ocorrido_em`, [org.id, { motivo: 'INCIDENTE' }, usuarios]);
        await c.query('SELECT pg_notify($1, $2)', ['eventos', JSON.stringify({ org: org.id, para: usuarios, evento: { id: idEvento(ev.rows[0].seq), tipo: 'sessao.encerrada', ocorridoEm: ev.rows[0].ocorrido_em.toISOString().replace(/\.\d{3}Z$/, 'Z'), dados: { motivo: 'INCIDENTE' } } })]);
        for (const s of r.rows) await c.query('SELECT pg_notify($1, $2)', ['eventos', JSON.stringify({ org: org.id, sessaoEncerrada: s.id })]);
      }
      await auditar(c, org.id, 'REVOGAR_SESSOES', 'sessao', usuario ?? '*');
      return r.rowCount;
    });
    console.log(`${n} sessão(ões) revogada(s) em ${org.slug}${usuario ? ` (usuário ${usuario})` : ''}. Tokens de acesso deixam de valer na próxima requisição.`);
  } else if (acao === 'suspender') {
    const status = tem('--reativar') ? 'ATIVA' : 'SUSPENSA';
    await c.query('UPDATE organizacoes SET status = $2, versao = versao + 1 WHERE id = $1', [org.id, status]);
    await comContexto(c, org.id, () => auditar(c, org.id, status === 'SUSPENSA' ? 'SUSPENDER_ORGANIZACAO' : 'REATIVAR_ORGANIZACAO', 'organizacao', org.id));
    console.log(`${org.slug}: ${status}. As instâncias aplicam em até 10 s (cache da organização).`);
  } else if (acao === 'acessos') {
    const paciente = arg('--paciente');
    if (!paciente) throw new Error('informe --paciente');
    const desde = arg('--desde') ?? '1970-01-01';
    const linhas = await comContexto(c, org.id, async () => {
      await auditar(c, org.id, 'CONSULTAR_ACESSOS', 'paciente', paciente);
      // Tudo que pertence ao paciente: o cadastro e os recursos ligados a ele.
      return (await c.query(`
        WITH ids AS (
          SELECT $2::text AS id
          UNION SELECT id FROM acompanhamentos WHERE organizacao_id = $1 AND paciente_id = $2
          UNION SELECT id FROM checkins WHERE organizacao_id = $1 AND paciente_id = $2
          UNION SELECT id FROM alertas WHERE organizacao_id = $1 AND paciente_id = $2
          UNION SELECT id FROM conversas WHERE organizacao_id = $1 AND paciente_id = $2)
        SELECT a.em, a.usuario_id, u.nome_exibicao, a.acao, a.recurso, a.recurso_id, host(a.ip) AS ip, a.request_id
          FROM auditoria a LEFT JOIN usuarios u ON u.organizacao_id = a.organizacao_id AND u.id = a.usuario_id
         WHERE a.organizacao_id = $1 AND a.recurso_id IN (SELECT id FROM ids) AND a.em >= $3::date
         ORDER BY a.em`, [org.id, paciente, desde])).rows;
    });
    const csv = (v: unknown) => (v == null ? '' : `"${String(v instanceof Date ? v.toISOString() : v).replace(/"/g, '""')}"`);
    console.log('em,usuario_id,nome,acao,recurso,recurso_id,ip,request_id');
    for (const l of linhas) console.log([l.em, l.usuario_id, l.nome_exibicao, l.acao, l.recurso, l.recurso_id, l.ip, l.request_id].map(csv).join(','));
    console.error(`${linhas.length} registro(s).`);
  } else {
    throw new Error('ação desconhecida: use revogar-sessoes | suspender | acessos');
  }
} catch (e: any) {
  console.error(`erro: ${e.message}`);
  process.exitCode = 1;
} finally { await c.end(); }
