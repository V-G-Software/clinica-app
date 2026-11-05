// Aplica as migrations em ordem, como clinica_dono. Cada arquivo roda numa transação.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.ts';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migracoes');
export async function migrar(url = config.bancoDono, silencioso = false) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS schema_migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())');
    const feitas = new Set((await c.query('SELECT nome FROM schema_migracoes')).rows.map((r) => r.nome));
    for (const arq of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (feitas.has(arq)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(path.join(dir, arq), 'utf8'));
        await c.query('INSERT INTO schema_migracoes (nome) VALUES ($1)', [arq]);
        await c.query('COMMIT');
        if (!silencioso) console.log(`migration aplicada: ${arq}`);
      } catch (e) { await c.query('ROLLBACK'); throw new Error(`${arq}: ${(e as Error).message}`); }
    }
  } finally { await c.end(); }
}
if (import.meta.url === `file://${process.argv[1]}`) migrar().catch((e) => { console.error(e.message); process.exit(1); });
