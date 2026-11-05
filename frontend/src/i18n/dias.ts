// Datas do protocolo: o dia 0 é a dataInicio (RN-ACO-001); dias contados em datas locais.
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
export const hojeNoFuso = (agoraMs: number, fuso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date(agoraMs));
