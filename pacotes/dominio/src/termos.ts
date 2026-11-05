export interface Termo { singular: string; plural: string; genero: 'M' | 'F' }
export const flex = (t: Termo, masculino: string, feminino: string) => (t.genero === 'F' ? feminino : masculino);
export const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s);
export const normalizar = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
