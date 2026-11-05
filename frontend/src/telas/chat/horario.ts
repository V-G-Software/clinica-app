// Horário de atendimento no fuso da organização (RN-CHA-006). Só para avisar antes de enviar;
// quem decide a mensagem de fora do horário é o backend.
export function dentroDoHorario(horarios: Array<{ diaSemana: number; inicio: string; fim: string }>, agoraMs: number, fuso: string) {
  if (!horarios.length) return true;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(agoraMs)).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const hora = `${p.hour}:${p.minute}`;
  return horarios.some((h) => h.diaSemana === dia && hora >= h.inicio && hora < h.fim);
}
