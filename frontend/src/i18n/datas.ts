// Datas clínicas sempre no fuso da organização, não no do aparelho (o paciente pode estar viajando).

/** Formata um instante ISO (UTC) no fuso da organização. */
export function formatarDataHora(iso: string, fuso: string, locale = 'pt-BR', opcoes: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }) {
  return new Intl.DateTimeFormat(locale, { timeZone: fuso, ...opcoes }).format(new Date(iso));
}
export const formatarHora = (iso: string, fuso: string, locale = 'pt-BR') => formatarDataHora(iso, fuso, locale, { hour: '2-digit', minute: '2-digit' });

/**
 * Formata uma data sem hora (AAAA-MM-DD) sem passar pelo fuso do aparelho:
 * `new Date('2026-11-05')` é meia-noite UTC e vira 04/11 no Brasil — erro clássico.
 */
export function formatarData(data: string, locale = 'pt-BR', opcoes: Intl.DateTimeFormatOptions = { dateStyle: 'short' }) {
  const [a, m, d] = data.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opcoes }).format(new Date(Date.UTC(a, m - 1, d, 12)));
}

/** "agora", "há 5 min", "há 2 h", "ontem" ou a data, relativo a `agora` (ms). */
export function tempoRelativo(iso: string, agora: number, fuso: string, locale = 'pt-BR') {
  const diff = Math.round((agora - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < 45) return 'agora';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 6 * 3600) return rtf.format(-Math.round(diff / 3600), 'hour');
  const dia = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date(ms));
  const dias = Math.round((Date.parse(dia(agora)) - Date.parse(dia(Date.parse(iso)))) / 86_400_000);
  if (dias === 0) return formatarHora(iso, fuso, locale);
  if (dias === 1) return rtf.format(-1, 'day');
  return formatarDataHora(iso, fuso, locale, { day: '2-digit', month: '2-digit' });
}
