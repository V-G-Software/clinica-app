// Relógio simulado e conversões de fuso. O relógio anda junto com o tempo real a partir de um
// deslocamento; POST /__mock/relogio avança o deslocamento e dispara os jobs vencidos.

export const RELOGIO_INICIAL = process.env.MOCK_RELOGIO_INICIAL ?? '2026-11-08T13:30:00Z';

let deslocamentoMs = Date.parse(RELOGIO_INICIAL) - Date.now();
let forcado: number | null = null;

export const agoraMs = (): number => forcado ?? Date.now() + deslocamentoMs;
export const agoraIso = (): string => iso(agoraMs());
export const iso = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export function definirRelogio(ms: number) {
  deslocamentoMs = ms - Date.now();
}
export function comRelogioForcado<T>(ms: number, fn: () => T): T {
  const anterior = forcado;
  forcado = ms;
  try {
    return fn();
  } finally {
    forcado = anterior;
  }
}

export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

/** Partes da data/hora local de um instante num fuso IANA. */
export function partesLocais(ms: number, fuso: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    data: `${p.year}-${p.month}-${p.day}`,
    hora: `${p.hour}:${p.minute}`,
    diaSemana: dias[p.weekday as string],
    ms: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second),
  };
}

/** Converte data local (AAAA-MM-DD) e hora (HH:MM) no fuso para instante UTC em ms. */
export function localParaUtc(data: string, hora: string, fuso: string): number {
  const [a, m, d] = data.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  const alvo = Date.UTC(a, m - 1, d, h, min);
  let t = alvo;
  for (let i = 0; i < 3; i++) {
    const offset = partesLocais(t, fuso).ms - t; // local - utc
    t = alvo - offset;
  }
  return t;
}

export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
export function diferencaDias(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA);
}
export const hojeLocal = (fuso: string) => partesLocais(agoraMs(), fuso).data;
