// Vocabulário do domínio vindo do manifesto (`termos`), com gênero gramatical.
// Combine com o vue-i18n por interpolação; nunca escreva "paciente" fixo na interface.
import type { Manifesto } from '@clinica/contrato-tipos';

export type Termo = { singular: string; plural: string; genero: 'M' | 'F' };
export type Termos = Manifesto['termos'];

const g = (t: Termo, m: string, f: string) => (t.genero === 'F' ? f : m);
export const capitalizar = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s);
/** Escolhe a forma pelo gênero do termo: flexao(consulta, 'meus', 'minhas'). */
export const flexao = g;
export const artigo = (t: Termo) => g(t, 'o', 'a');
export const artigoPlural = (t: Termo) => g(t, 'os', 'as');
export const novo = (t: Termo) => `${g(t, 'novo', 'nova')} ${t.singular}`;
export const nenhum = (t: Termo) => `${g(t, 'nenhum', 'nenhuma')} ${t.singular}`;
export const meu = (t: Termo) => `${g(t, 'meu', 'minha')} ${t.singular}`;
/** Sufixo de concordância para adjetivos e particípios: cadastrad{o|a}. */
export const sufixo = (t: Termo) => g(t, 'o', 'a');
/** "1 paciente" / "3 pacientes". */
export const contar = (n: number, t: Termo) => `${n} ${n === 1 ? t.singular : t.plural}`;

/** Termos padrão, usados só antes de o manifesto chegar (telas de login). */
export const TERMOS_PADRAO: Record<string, Termo> = {
  organizacao: { singular: 'clínica', plural: 'clínicas', genero: 'F' },
  paciente: { singular: 'paciente', plural: 'pacientes', genero: 'M' },
  responsavel: { singular: 'responsável', plural: 'responsáveis', genero: 'M' },
  profissional: { singular: 'profissional', plural: 'profissionais', genero: 'M' },
  acompanhamento: { singular: 'acompanhamento', plural: 'acompanhamentos', genero: 'M' },
  protocolo: { singular: 'protocolo', plural: 'protocolos', genero: 'M' },
  procedimento: { singular: 'procedimento', plural: 'procedimentos', genero: 'M' },
  checkin: { singular: 'check-in', plural: 'check-ins', genero: 'M' },
  conversa: { singular: 'conversa', plural: 'conversas', genero: 'F' },
  consulta: { singular: 'consulta', plural: 'consultas', genero: 'F' },
  exame: { singular: 'exame', plural: 'exames', genero: 'M' },
};
