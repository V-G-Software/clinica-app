// Acesso a dados. A aplicação usa o papel clinica_app (sem BYPASSRLS, não dono das tabelas).
// Toda consulta de dado de cliente roda dentro de comOrg(), que abre uma transação e define
// app.organizacao_id com set_config(..., true) — local à transação, nunca vaza entre conexões.
import pg from 'pg';
import { config } from './config.ts';

pg.types.setTypeParser(1082, (v) => v); // date → 'AAAA-MM-DD' (sem fuso)
pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number (contadores e seq)

export const pool = new pg.Pool({ connectionString: config.bancoApp, max: 20 });
export type Tx = pg.PoolClient;

/** Executa fn numa transação com o contexto da organização. Sem orgId, nada de cliente é acessível. */
export async function comOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error('comOrg sem organização');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.organizacao_id', $1, true)", [orgId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Consultas que não tocam dado de cliente (organizações, diretório). */
export const global = <T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) => pool.query<T>(sql, params);

export async function um<T extends pg.QueryResultRow = any>(tx: Tx, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await tx.query<T>(sql, params)).rows[0] ?? null;
}
export async function todos<T extends pg.QueryResultRow = any>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}
