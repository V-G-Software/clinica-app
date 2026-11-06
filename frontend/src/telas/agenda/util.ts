// Agenda (ADR-0016): `inicioEm`/`fimEm` trafegam em UTC; o que a pessoa vê e digita (dia, hora, grade,
// bloqueio) é no fuso da organização — nunca no do aparelho (paciente viajando vê o horário da clínica).
import type { Agendamento } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { somarDias } from '@/i18n/dias';

export type Status = Agendamento['status'];
export const STATUS: Record<Status, { rotulo: string; classe: string }> = {
  AGENDADO: { rotulo: 'Agendado', classe: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100' },
  CONFIRMADO: { rotulo: 'Confirmado', classe: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100' },
  REALIZADO: { rotulo: 'Realizado', classe: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100' },
  CANCELADO: { rotulo: 'Cancelado', classe: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100' },
  FALTOU: { rotulo: 'Faltou', classe: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100' },
};
export const ACAO_HISTORICO: Record<string, string> = {
  CRIADO: 'Marcado', CONFIRMADO: 'Confirmado', REMARCADO: 'Remarcado', CANCELADO: 'Cancelado', REALIZADO: 'Realizado', FALTOU: 'Falta registrada',
};
export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Data local (AAAA-MM-DD) de um instante no fuso da organização. */
export const diaNoFuso = (iso: string | number, fuso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date(iso));

/** Deslocamento (ms) do fuso em relação ao UTC num instante: positivo a leste. */
function deslocamento(ms: number, fuso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/**
 * Data + hora locais da organização → ISO UTC. Duas passadas acertam a virada de horário de verão
 * (o Brasil não tem mais, mas outras organizações/fusos podem ter).
 */
export function paraUtc(data: string, hora: string, fuso: string): string {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const local = Date.UTC(a, m - 1, d, h, mi);
  let ms = local - deslocamento(local, fuso);
  ms = local - deslocamento(ms, fuso);
  return new Date(ms).toISOString();
}

/** Dia da semana (0 = domingo) de uma data AAAA-MM-DD, sem passar pelo fuso do aparelho. */
export const diaDaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();
/** Segunda-feira da semana da data (semana de trabalho começa na segunda). */
export const inicioDaSemana = (data: string) => somarDias(data, -((diaDaSemana(data) + 6) % 7));

/** Lista todos os agendamentos do período, seguindo o cursor (um dia/semana raramente passa de 2 páginas). */
export async function listarPeriodo(query: { de: string; ate: string; profissionalId?: string; pacienteId?: string; status?: Status; categoria?: 'CONSULTA' | 'PROCEDIMENTO' }) {
  const itens: Agendamento[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const r = await ok(api().GET('/v1/agendamentos', { params: { query: { ...query, limite: 100, ...(cursor ? { cursor } : {}) } } }));
    itens.push(...r.itens);
    cursor = r.proximoCursor ?? undefined;
    if (!cursor) break;
  }
  return itens;
}

/** Agrupa horários por dia local, preservando a ordem. */
export function porDia<T extends { inicioEm: string }>(lista: T[], fuso: string): Array<{ dia: string; itens: T[] }> {
  const mapa = new Map<string, T[]>();
  for (const x of [...lista].sort((a, b) => a.inicioEm.localeCompare(b.inicioEm))) {
    const d = diaNoFuso(x.inicioEm, fuso);
    mapa.set(d, [...(mapa.get(d) ?? []), x]);
  }
  return [...mapa].map(([dia, itens]) => ({ dia, itens }));
}
