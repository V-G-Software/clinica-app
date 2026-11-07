// Exames (ADR-0017): pedido estruturado → resultado (foto ou PDF) → revisão com nota opcional.
import type { PedidoExame, ResultadoExame } from '@clinica/contrato-tipos';

export const STATUS_PEDIDO: Record<PedidoExame['status'], { rotulo: string; classe: string }> = {
  ABERTO: { rotulo: 'Aberto', classe: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100' },
  CONCLUIDO: { rotulo: 'Concluído', classe: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100' },
  CANCELADO: { rotulo: 'Cancelado', classe: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100' },
};
// Para o paciente, "aguardando revisão" é o que interessa: a equipe ainda não olhou.
export const STATUS_RESULTADO: Record<ResultadoExame['status'], { rotulo: string; classe: string }> = {
  AGUARDANDO_REVISAO: { rotulo: 'Aguardando revisão', classe: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100' },
  REVISADO: { rotulo: 'Revisado', classe: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100' },
};

export const ehPdf = (tipo: string) => tipo === 'application/pdf';

/** Tamanho legível (pt-BR): 850 KB, 2,4 MB. */
export function tamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/** Título sugerido para o resultado a partir dos itens do pedido ("Hemograma, Glicemia"). */
export function tituloSugerido(p: Pick<PedidoExame, 'itens'> | undefined): string {
  if (!p?.itens.length) return '';
  const t = p.itens.map((i) => i.nome).join(', ');
  return t.length <= 200 ? t : `${t.slice(0, 197)}…`;
}

/** URLs assinadas duram minutos: renovar um pouco antes de expirar (nunca abaixo de 30 s). */
export function intervaloRenovacao(urlsExpiramEm: string | null | undefined, agora: number): number | false {
  if (!urlsExpiramEm) return false;
  return Math.max(30_000, new Date(urlsExpiramEm).getTime() - agora - 30_000);
}
