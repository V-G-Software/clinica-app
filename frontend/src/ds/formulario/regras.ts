// Regras do formulário (seção 9.2 / 10): mesmos operadores do backend. A validação local é só
// para retorno rápido; a resposta do servidor (422 com campos) é a que vale.
import type { CampoFormulario } from '@clinica/contrato-tipos';

export type Respostas = Record<string, unknown>;
export const TIPOS_CONHECIDOS = new Set(['TEXTO', 'TEXTO_LONGO', 'NUMERO', 'ESCALA', 'SIM_NAO', 'ESCOLHA_UNICA', 'ESCOLHA_MULTIPLA', 'DATA', 'HORA', 'FOTO', 'INFORMACAO']);

export function compara(valor: unknown, operador: string, alvo: unknown): boolean {
  if (valor === undefined || valor === null) return false;
  switch (operador) {
    case 'IGUAL': return valor === alvo;
    case 'DIFERENTE': return valor !== alvo;
    case 'MAIOR_OU_IGUAL': return typeof valor === 'number' && valor >= (alvo as number);
    case 'MENOR_OU_IGUAL': return typeof valor === 'number' && valor <= (alvo as number);
    case 'CONTEM': return Array.isArray(valor) ? valor.includes(alvo) : typeof valor === 'string' && valor.includes(String(alvo));
    default: return false; // operador desconhecido: trata como não satisfeito
  }
}
export const visivel = (c: CampoFormulario, r: Respostas) => !c.visivelSe || compara(r[c.visivelSe.campo], c.visivelSe.operador as string, c.visivelSe.valor);
export const camposVisiveis = (campos: CampoFormulario[], r: Respostas) => campos.filter((c) => visivel(c, r));

/** Remove valores de campos ocultos (o backend recusa valor de campo invisível) e vazios. */
export function limparRespostas(campos: CampoFormulario[], r: Respostas): Respostas {
  const saida: Respostas = {};
  for (const c of campos) {
    if (c.tipo === 'INFORMACAO' || !visivel(c, r)) continue;
    const v = r[c.id];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    saida[c.id] = v;
  }
  return saida;
}

export const vazio = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Erro de um campo, ou null. Mensagens curtas e no tom do paciente. */
export function validarCampo(c: CampoFormulario, v: unknown): string | null {
  if (c.tipo === 'INFORMACAO') return null;
  if (!TIPOS_CONHECIDOS.has(c.tipo as string)) return c.obrigatorio ? 'Atualize o app para responder esta pergunta.' : null;
  if (vazio(v)) return c.obrigatorio ? 'Responda esta pergunta para continuar.' : null;
  if (c.tipo === 'NUMERO' || c.tipo === 'ESCALA') {
    if (typeof v !== 'number' || Number.isNaN(v)) return 'Digite um número.';
    if ((c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max)) return `Use um valor entre ${c.min} e ${c.max}.`;
    if (c.tipo === 'NUMERO' && c.casasDecimais !== undefined && Math.round(v * 10 ** c.casasDecimais) / 10 ** c.casasDecimais !== v) return `Use até ${c.casasDecimais} casa(s) decimal(is).`;
  }
  if (c.tipo === 'FOTO' && Array.isArray(v) && c.maximo && v.length > c.maximo) return `Envie no máximo ${c.maximo}.`;
  return null;
}
export function validarTudo(campos: CampoFormulario[], r: Respostas): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const c of camposVisiveis(campos, r)) { const e = validarCampo(c, r[c.id]); if (e) erros[c.id] = e; }
  return erros;
}
/** "37,5" → 37.5 (teclado brasileiro). */
export function lerNumero(texto: string): number | undefined {
  const t = texto.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
