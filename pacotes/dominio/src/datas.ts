// Datas no fuso da organização (IANA), sem relógio: quem chama passa o instante. O mesmo cálculo no
// backend e no mock, para que "dia 1 às 09:00" caia no mesmo instante UTC nos dois.
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

/** Data local (AAAA-MM-DD) e hora (HH:MM) no fuso → instante UTC em ms (resolve horário de verão). */
export function localParaUtc(data: string, hora: string, fuso: string): number {
  const [a, m, d] = data.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  const alvo = Date.UTC(a, m - 1, d, h, min);
  let t = alvo;
  for (let i = 0; i < 3; i++) t = alvo - (partesLocais(t, fuso).ms - t);
  return t;
}
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
export const diferencaDias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA);
