// Jobs agendados (14.3) numa tabela do próprio Postgres, com FOR UPDATE SKIP LOCKED (ADR-0014).
//  - agendar() grava na MESMA transação da regra: se a requisição desfaz, o job não existe.
//  - Id determinístico (checkin:{id}:abrir): reagendar é upsert; cancelar é apagar por prefixo.
//  - O worker reivindica lotes entre organizações só por id e executa cada job em comOrg(org): o
//    job conclui (DELETE) na mesma transação do efeito — ou tudo acontece, ou o job volta para a fila.
//  - Handlers são idempotentes e conferem o estado (check-in já respondido, acompanhamento encerrado).
import { comOrg, pool, type Tx } from '../db.ts';
import type { Log } from '../http.ts';

export type HandlerJob = (tx: Tx, orgId: string, dados: any, log: Log) => Promise<void>;
const handlers = new Map<string, HandlerJob>();
export const registrarJob = (tipo: string, h: HandlerJob) => handlers.set(tipo, h);

const MAX_TENTATIVAS = 5;
const BLOQUEIO = '5 minutes';

export async function agendar(tx: Tx, orgId: string, id: string, tipo: string, quando: Date | number, dados: Record<string, unknown> = {}) {
  await tx.query(
    `INSERT INTO jobs (organizacao_id, id, tipo, dados, executar_em) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (organizacao_id, id) DO UPDATE SET tipo = EXCLUDED.tipo, dados = EXCLUDED.dados, executar_em = EXCLUDED.executar_em,
       tentativas = 0, bloqueado_ate = NULL, ultimo_erro = NULL, falhou_em = NULL`,
    [orgId, id, tipo, dados, new Date(quando)]);
}
export async function cancelarPrefixo(tx: Tx, orgId: string, prefixo: string) {
  await tx.query(`DELETE FROM jobs WHERE organizacao_id = $1 AND id LIKE $2`, [orgId, `${prefixo.replace(/[%_\\]/g, '\\$&')}%`]);
}

/** Executa os jobs vencidos uma vez. Devolve quantos rodaram (o worker repete enquanto houver). */
export async function executarVencidos(log: Log, limite = 20): Promise<number> {
  const { rows } = await pool.query<{ organizacao_id: string; id: string; tipo: string; dados: any; tentativas: number }>(
    'SELECT * FROM reivindicar_jobs($1, $2::interval)', [limite, BLOQUEIO]);
  for (const j of rows) {
    const h = handlers.get(j.tipo);
    try {
      if (!h) throw new Error(`tipo de job desconhecido: ${j.tipo}`);
      await comOrg(j.organizacao_id, async (tx) => {
        await h(tx, j.organizacao_id, j.dados, log);
        await tx.query('DELETE FROM jobs WHERE organizacao_id = $1 AND id = $2', [j.organizacao_id, j.id]);
      });
    } catch (e: any) {
      // Backoff exponencial (30 s, 1 min, 2 min, ...); depois de 5 tentativas fica registrado como falho.
      const falhou = j.tentativas >= MAX_TENTATIVAS;
      log.error({ job: j.id, tipo: j.tipo, org: j.organizacao_id, tentativa: j.tentativas, err: e?.message }, falhou ? 'job falhou definitivamente' : 'job falhou; nova tentativa');
      await comOrg(j.organizacao_id, (tx) => tx.query(
        `UPDATE jobs SET ultimo_erro = $3, bloqueado_ate = now() + make_interval(secs => 30 * 2 ^ ($4 - 1)), falhou_em = CASE WHEN $5 THEN now() END
          WHERE organizacao_id = $1 AND id = $2`, [j.organizacao_id, j.id, String(e?.message ?? e).slice(0, 500), j.tentativas, falhou])).catch(() => undefined);
    }
  }
  return rows.length;
}

let timer: NodeJS.Timeout | null = null;
let rodando = false;
/** Worker no mesmo processo da API (14.1: "um contêiner com API e worker"). Várias instâncias são seguras. */
export function iniciarWorker(log: Log, intervaloMs = Number(process.env.JOBS_INTERVALO_MS ?? 2000)) {
  const ciclo = async () => {
    if (rodando) return;
    rodando = true;
    try { while ((await executarVencidos(log)) > 0); } catch (e: any) { log.error({ err: e?.message }, 'worker de jobs'); } finally { rodando = false; }
  };
  timer = setInterval(() => void ciclo(), intervaloMs);
  void ciclo();
}
export function pararWorker() { if (timer) clearInterval(timer); timer = null; }
