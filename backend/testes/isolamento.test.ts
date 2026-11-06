// Isolamento entre organizações, em duas camadas independentes:
//  1. Banco: o papel clinica_app, sem contexto ou com o contexto de outra organização, não lê nem grava
//     linhas alheias (RLS ENABLE + FORCE). Protege mesmo contra um bug de WHERE esquecido na aplicação.
//  2. HTTP: token de uma organização não vale em outra; id de recurso de outra organização é 404.
// Pré-requisito: banco migrado e semeado (pnpm migrar && pnpm org:criar --todos), MODO_TESTE_CODIGO_EMAIL definido.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import { comOrg, pool } from '../src/db.ts';
import { criarServidor } from '../src/servidor.ts';

const TABELAS_COM_RLS = [
  'usuarios', 'pacientes', 'vinculos', 'convites', 'desafios', 'codigos_email', 'sessoes', 'tokens_renovacao',
  'tokens_senha', 'idempotencia', 'tentativas', 'notificacoes', 'inscricoes_push', 'arquivos', 'eventos', 'auditoria', 'formularios',
  'protocolos', 'acompanhamentos', 'checkins', 'alertas', 'conversas', 'participantes', 'mensagens',
];

describe('isolamento no banco (RLS)', () => {
  it('todas as tabelas de cliente têm RLS habilitado e forçado', async () => {
    const { rows } = await pool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`,
    );
    const porNome = new Map(rows.map((r) => [r.relname, r]));
    for (const t of TABELAS_COM_RLS) {
      expect(porNome.get(t), t).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
    // Tabela nova sem RLS é o erro mais provável numa migration futura: só organizacoes e o controle de migrations ficam de fora.
    const semRls = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname).sort();
    expect(semRls).toEqual(['organizacoes', 'schema_migracoes']);
    // jobs: RLS habilitado e NÃO forçado, de propósito — só reivindicar_jobs() (dono) atravessa organizações.
    const naoForcadas = rows.filter((r) => r.relrowsecurity && !r.relforcerowsecurity).map((r) => r.relname);
    expect(naoForcadas).toEqual(['jobs']);
  });

  it('jobs: a aplicação só lê e grava jobs da própria organização', async () => {
    const outros = await comOrg('org_vet', async (tx) => (await tx.query("SELECT count(*)::int AS n FROM jobs WHERE organizacao_id <> 'org_vet'")).rows[0].n);
    expect(outros).toBe(0);
    await expect(comOrg('org_vet', (tx) => tx.query(
      `INSERT INTO jobs (organizacao_id, id, tipo, executar_em) VALUES ('org_otorrino', 'teste:x', 'teste', now())`))).rejects.toThrow(/row-level security/);
  });

  it('o papel da aplicação não ignora RLS nem é dono das tabelas', async () => {
    const { rows } = await pool.query(
      `SELECT r.rolbypassrls, r.rolsuper, (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid AND c.relnamespace = 'public'::regnamespace)::int AS dono
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, dono: 0 });
  });

  it('sem contexto de organização, consulta falha (conexão nova) ou volta vazia (conexão reaproveitada)', async () => {
    const c = new pg.Client({ connectionString: config.bancoApp });
    await c.connect();
    try {
      // Conexão que nunca definiu app.organizacao_id: current_setting sem missing_ok levanta erro.
      await expect(c.query('SELECT count(*) FROM pacientes')).rejects.toThrow(/app\.organizacao_id/);
      // Depois de um set_config local, a variável volta a '' ao fim da transação: nenhuma linha casa.
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.organizacao_id', 'org_vet', true)");
      await c.query('COMMIT');
      expect((await c.query('SELECT count(*)::int AS n FROM pacientes')).rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('com contexto de uma organização, só enxerga as próprias linhas', async () => {
    const orgs = await comOrg('org_vet', async (tx) => (await tx.query('SELECT DISTINCT organizacao_id FROM pacientes')).rows);
    expect(orgs).toEqual([{ organizacao_id: 'org_vet' }]);
    const alheio = await comOrg('org_vet', async (tx) => (await tx.query("SELECT id FROM pacientes WHERE id = 'pac_marcos'")).rows);
    expect(alheio).toEqual([]);
  });

  it('não grava nem altera linha de outra organização', async () => {
    await expect(
      comOrg('org_vet', (tx) => tx.query(
        `INSERT INTO auditoria (organizacao_id, acao, recurso, recurso_id) VALUES ('org_otorrino', 'TESTE', 'TESTE', 'x')`,
      )),
    ).rejects.toThrow(/row-level security/);
    const alterados = await comOrg('org_vet', async (tx) => (await tx.query("UPDATE pacientes SET nome = nome WHERE organizacao_id = 'org_otorrino'")).rowCount);
    expect(alterados).toBe(0);
  });

  it('auditoria é só acréscimo para a aplicação', async () => {
    await expect(comOrg('org_vet', (tx) => tx.query('DELETE FROM auditoria'))).rejects.toThrow(/permission denied/);
    await expect(comOrg('org_vet', (tx) => tx.query("UPDATE auditoria SET acao = 'X'"))).rejects.toThrow(/permission denied/);
  });
});

describe('isolamento na API', () => {
  const app = criarServidor();
  let tokenVet = '';

  async function chamar(slug: string, metodo: 'GET' | 'POST', rota: string, corpo?: unknown, token?: string) {
    const r = await app.inject({
      method: metodo,
      url: `/o/${slug}${rota}`,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null };
  }

  /** Login do paciente por código (MODO_TESTE_CODIGO_EMAIL), aceitando termos se pedido. */
  async function entrarPaciente(slug: string, email: string): Promise<string> {
    expect((await chamar(slug, 'POST', '/v1/auth/codigo/solicitar', { email })).status).toBe(202);
    let r = await chamar(slug, 'POST', '/v1/auth/codigo/verificar', { email, codigo: config.modoTeste.codigoEmail });
    for (let i = 0; i < 3 && r.corpo?.etapa === 'ACEITAR_TERMOS'; i++) {
      r = await chamar(slug, 'POST', '/v1/auth/termos/aceitar', { desafioId: r.corpo.desafioId, termosVersao: r.corpo.termos?.versao });
    }
    expect(r.status, JSON.stringify(r.corpo)).toBe(200);
    expect(r.corpo.etapa).toBe('CONCLUIDO');
    return r.corpo.tokenAcesso;
  }

  beforeAll(async () => {
    if (!config.modoTeste.codigoEmail) throw new Error('defina MODO_TESTE_CODIGO_EMAIL para os testes de API');
    await app.ready();
    await pool.query("SELECT 1"); // falha cedo se o banco não estiver no ar
    await comOrg('org_vet', (tx) => tx.query('DELETE FROM tentativas'));
    tokenVet = await entrarPaciente('vet-amigo', 'laura@exemplo.com');
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  it('token de uma organização é recusado em outra (401, não 403: não revela a existência da conta)', async () => {
    const r = await chamar('modelo-otorrino', 'GET', '/v1/sessao', undefined, tokenVet);
    expect(r.status).toBe(401);
  });

  it('o mesmo token funciona na própria organização', async () => {
    expect((await chamar('vet-amigo', 'GET', '/v1/sessao', undefined, tokenVet)).status).toBe(200);
  });

  it('id de paciente de outra organização é 404 (mesmo formato de um id inexistente)', async () => {
    const alheio = await chamar('vet-amigo', 'GET', '/v1/pacientes/pac_marcos', undefined, tokenVet);
    const inexistente = await chamar('vet-amigo', 'GET', '/v1/pacientes/pac_nao_existe', undefined, tokenVet);
    expect(alheio.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(alheio.corpo.codigo).toBe(inexistente.corpo.codigo);
    expect(alheio.corpo.detail).toBe(inexistente.corpo.detail);
  });
});
