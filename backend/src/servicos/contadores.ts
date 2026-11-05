// Contadores do manifesto e de GET /v1/contadores. Na F1, chat e acompanhamento ainda não têm
// tabelas: os contadores existem (o menu os referencia) e valem 0 até a F2.
import { temModulo } from '@clinica/dominio';
import { um, type Tx } from '../db.ts';
import type { Org } from '../nucleo.ts';

export async function contadoresDe(tx: Tx, org: Org, usuarioId: string): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  r['notificacoes.naoLidas'] = (await um<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM notificacoes WHERE organizacao_id = $1 AND usuario_id = $2 AND lido_em IS NULL', [org.id, usuarioId]))!.n;
  if (temModulo(org.modulos, 'chat')) r['chat.naoLidas'] = 0;
  if (temModulo(org.modulos, 'acompanhamento')) { r['acompanhamento.alertasAbertos'] = 0; r['acompanhamento.checkinsPendentes'] = 0; }
  return r;
}
