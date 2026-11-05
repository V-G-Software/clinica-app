// Celular em E.164 (4.4). Sem "+", assume Brasil (+55). Exibição no formato nacional.
export function paraE164(texto: string, ddiPadrao = '55'): string | null {
  const t = texto.trim();
  if (!t) return null;
  const digitos = t.replace(/\D/g, '');
  if (t.startsWith('+')) return digitos.length >= 8 && digitos.length <= 15 ? `+${digitos}` : null;
  const semZero = digitos.replace(/^0+/, '');
  if (semZero.length === 10 || semZero.length === 11) return `+${ddiPadrao}${semZero}`;
  return null;
}
export function formatarTelefone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
