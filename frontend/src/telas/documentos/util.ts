// Documentos (ADR-0018): receita e atestado assinados no PSC em nuvem do médico e entregues pelo chat.
import type { ConteudoAtestado, ConteudoReceita, Documento } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';

export const TIPO: Record<Documento['tipo'], string> = { RECEITA: 'Receita', ATESTADO: 'Atestado' };
export const STATUS: Record<Documento['status'], { rotulo: string; classe: string }> = {
  RASCUNHO: { rotulo: 'Rascunho', classe: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100' },
  ASSINANDO: { rotulo: 'Assinando…', classe: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100' },
  ASSINADO: { rotulo: 'Assinado', classe: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100' },
  DESCARTADO: { rotulo: 'Descartado', classe: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  ANULADO: { rotulo: 'Anulado', classe: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100' },
};

const br = (d: string) => d.split('-').reverse().join('/');
/** Uma linha que descreve o conteúdo (lista, início). Sem detalhes clínicos além do que a equipe já vê. */
export function resumo(d: Pick<Documento, 'tipo' | 'receita' | 'atestado'>): string {
  if (d.receita) return d.receita.itens.map((i) => i.medicamento).join(', ');
  const a = d.atestado;
  if (!a) return '';
  return a.modalidade === 'AFASTAMENTO' ? `Afastamento de ${a.dias} dia${a.dias === 1 ? '' : 's'} a partir de ${br(a.data)}` : `Comparecimento em ${br(a.data)}, ${a.horaInicio}–${a.horaFim}`;
}

// ─────────── Formulário (rascunho) ───────────
export interface FormReceita { itens: Array<{ medicamento: string; posologia: string; quantidade: string }>; orientacoes: string }
export interface FormAtestado { modalidade: 'AFASTAMENTO' | 'COMPARECIMENTO'; data: string; dias: string; horaInicio: string; horaFim: string; cid: string; cidAutorizado: boolean; observacoes: string }
export const receitaVazia = (): FormReceita => ({ itens: [{ medicamento: '', posologia: '', quantidade: '' }], orientacoes: '' });
export const atestadoVazio = (hoje: string): FormAtestado => ({ modalidade: 'AFASTAMENTO', data: hoje, dias: '1', horaInicio: '', horaFim: '', cid: '', cidAutorizado: false, observacoes: '' });
export const receitaDoDoc = (r: ConteudoReceita): FormReceita => ({ itens: r.itens.map((i) => ({ medicamento: i.medicamento, posologia: i.posologia, quantidade: i.quantidade ?? '' })), orientacoes: r.orientacoes ?? '' });
export const atestadoDoDoc = (a: ConteudoAtestado): FormAtestado => ({ modalidade: a.modalidade, data: a.data, dias: a.dias ? String(a.dias) : '', horaInicio: a.horaInicio ?? '', horaFim: a.horaFim ?? '', cid: a.cid ?? '', cidAutorizado: !!a.cidAutorizado, observacoes: a.observacoes ?? '' });

/** Valida no aparelho o que o backend também valida (RN-DOC-003); devolve a primeira mensagem ou null. */
export function problemaReceita(f: FormReceita): string | null {
  const itens = f.itens.filter((i) => i.medicamento.trim() || i.posologia.trim());
  if (!itens.length) return 'Inclua ao menos um medicamento.';
  if (itens.some((i) => i.medicamento.trim().length < 2)) return 'Informe o nome de cada medicamento.';
  if (itens.some((i) => i.posologia.trim().length < 2)) return 'Informe a posologia de cada medicamento.';
  return null;
}
export function problemaAtestado(f: FormAtestado): string | null {
  if (!f.data) return 'Informe a data.';
  if (f.modalidade === 'AFASTAMENTO' && !(Number(f.dias) >= 1 && Number(f.dias) <= 365)) return 'Informe de 1 a 365 dias.';
  if (f.modalidade === 'COMPARECIMENTO') {
    if (!/^\d{2}:\d{2}$/.test(f.horaInicio) || !/^\d{2}:\d{2}$/.test(f.horaFim)) return 'Informe o horário de início e de fim.';
    if (f.horaFim <= f.horaInicio) return 'O fim precisa ser depois do início.';
  }
  if (f.cid.trim() && !/^[A-Z][0-9]{2}(\.[0-9]{1,2})?$/.test(f.cid.trim().toUpperCase())) return 'CID no formato A00 ou A00.0.';
  if (f.cid.trim() && !f.cidAutorizado) return 'O CID só pode constar com a autorização expressa do paciente.';
  return null;
}
export const corpoReceita = (f: FormReceita): ConteudoReceita => ({
  itens: f.itens.filter((i) => i.medicamento.trim()).map((i) => ({ medicamento: i.medicamento.trim(), posologia: i.posologia.trim(), quantidade: i.quantidade.trim() || null })),
  orientacoes: f.orientacoes.trim() || null,
});
export const corpoAtestado = (f: FormAtestado): ConteudoAtestado => ({
  modalidade: f.modalidade, data: f.data,
  dias: f.modalidade === 'AFASTAMENTO' ? Number(f.dias) : null,
  horaInicio: f.modalidade === 'COMPARECIMENTO' ? f.horaInicio : null, horaFim: f.modalidade === 'COMPARECIMENTO' ? f.horaFim : null,
  cid: f.cid.trim() ? f.cid.trim().toUpperCase() : null, cidAutorizado: !!f.cid.trim() && f.cidAutorizado, observacoes: f.observacoes.trim() || null,
});

// ─────────── Assinatura (PSC em nuvem) ───────────
const CHAVE_PROVEDOR = 'documentos.provedor';
export function provedorLembrado(): string | null { try { return localStorage.getItem(CHAVE_PROVEDOR); } catch { return null; } }
function lembrarProvedor(id: string) { try { localStorage.setItem(CHAVE_PROVEDOR, id); } catch { /* sem armazenamento: só não lembra */ } }
/** Para onde o PSC devolve o navegador (o backend acrescenta ?assinatura={id}). Sempre a lista de documentos. */
export const retornoDaAssinatura = () => `${window.location.origin}/documentos`;

/**
 * Inicia a sessão e leva o navegador ao app do provedor (sai do app: OAuth com redirecionamento).
 * Idempotency-Key por ação: um duplo toque não cria duas sessões.
 */
export async function assinar(documentosIds: string[], provedor: string, chave: string, ir: (url: string) => void = (u) => window.location.assign(u)) {
  const s = await ok(api().POST('/v1/documentos/assinaturas', { params: { header: { 'Idempotency-Key': chave } }, body: { documentosIds, provedor, retornoUrl: retornoDaAssinatura() } }));
  lembrarProvedor(provedor);
  if (s.urlAutorizacao) ir(s.urlAutorizacao);
  return s;
}
