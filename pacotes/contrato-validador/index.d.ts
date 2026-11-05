export interface ErroCampo { campo: string; codigo: string; mensagem: string }
export interface Resultado { ok: boolean; erros: ErroCampo[] }
export interface Operacao {
  operationId: string; metodo: string; caminho: string; tag?: string;
  publico: boolean; idempotente: boolean; exigeIfMatch: boolean; parametros: any[]; ponteiro: string; op: any;
}
export const contrato: any;
export const caminhoContrato: string;
export const versaoContrato: string;
export const operacoes: Record<string, Operacao>;
export function validarSchema(nome: string, valor: unknown): Resultado;
export function validarRequisicao(operationId: string, req: { params?: Record<string, string>; query?: Record<string, any>; headers?: Record<string, any>; body?: unknown; temCorpo?: boolean }): Resultado & { query: Record<string, any> };
export function validarResposta(operationId: string, status: number, contentType: string | undefined, body: unknown): Resultado;
export function encontrarOperacao(metodo: string, caminho: string): { operacao: Operacao; params: Record<string, string> } | null;
