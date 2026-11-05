// Cliente HTTP da suíte: toda resposta é validada contra o contrato (schema, status declarado,
// content-type, formato RFC 9457 dos erros) e o uso de cada operação é registrado para o relatório.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { encontrarOperacao, validarResposta } from '@clinica/contrato-validador';

export interface Resposta<T = any> { status: number; body: T; headers: Headers; operationId: string; requestId: string }
export interface Opcoes {
  token?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string | number | boolean | undefined>;
  nativo?: boolean; base?: string; idempotencia?: string | true;
}

const VAZAMENTO = /(\bat [\w.<>]+ \(|stack|traceback|SELECT\s|INSERT\s|UPDATE\s|pg_|sqlstate|ORA-\d|Exception)/i;

export function criarCliente(urlApi: string) {
  const base0 = urlApi.replace(/\/$/, '');
  const prefixo = new URL(base0).pathname.replace(/\/$/, '');

  async function chamar<T = any>(metodo: string, caminho: string, o: Opcoes = {}): Promise<Resposta<T>> {
    const base = o.base ?? base0;
    const qs = o.query ? '?' + new URLSearchParams(Object.entries(o.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
    const requestId = `conf_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const headers: Record<string, string> = { 'X-Request-Id': requestId, 'X-Cliente': o.nativo === false ? 'WEB' : 'NATIVO', 'X-Cliente-Versao': '1.0.0-conformidade', ...o.headers };
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.idempotencia) headers['Idempotency-Key'] = o.idempotencia === true ? randomUUID() : o.idempotencia;
    const res = await fetch(base + caminho + qs, { method: metodo, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), redirect: 'manual' });
    const ct = res.headers.get('content-type') ?? '';
    const texto = await res.text();
    let body: any = undefined;
    if (texto) {
      if (/json/.test(ct)) body = JSON.parse(texto);
      else body = texto;
    }
    const caminhoContrato = new URL(base + caminho).pathname.slice(base === base0 ? prefixo.length : new URL(base).pathname.replace(/\/$/, '').length);
    const achada = encontrarOperacao(metodo, caminhoContrato);
    if (!achada) throw new Error(`[suíte] ${metodo} ${caminhoContrato} não existe no contrato`);
    const operationId = achada.operacao.operationId;
    registrar(operationId, res.status);
    const v = validarResposta(operationId, res.status, texto ? ct : undefined, body);
    if (!v.ok) throw new Error(`Resposta fora do contrato em ${operationId} (HTTP ${res.status}):\n- ${v.erros.map((e) => e.mensagem).join('\n- ')}\nCorpo: ${texto.slice(0, 800)}`);
    if (res.status >= 400) {
      if (body?.requestId === undefined) throw new Error(`Erro sem requestId em ${operationId}`);
      if (VAZAMENTO.test(JSON.stringify(body))) throw new Error(`Erro expõe detalhe interno em ${operationId}: ${texto.slice(0, 300)}`);
    }
    const devolvido = res.headers.get('x-request-id');
    if (devolvido !== requestId) throw new Error(`X-Request-Id não devolvido em ${operationId} (enviado ${requestId}, recebido ${devolvido})`);
    return { status: res.status, body, headers: res.headers, operationId, requestId };
  }
  return { chamar, urlApi: base0 };
}
export type Cliente = ReturnType<typeof criarCliente>;

function registrar(operationId: string, status: number) {
  const arq = process.env.CONF_COBERTURA_ARQ;
  if (arq) appendFileSync(arq, JSON.stringify({ operationId, status }) + '\n');
}

/** Falha com mensagem útil quando o status não é o esperado. */
export function esperar<T>(r: Resposta<T>, status: number | number[], codigo?: string): Resposta<T> {
  const lista = Array.isArray(status) ? status : [status];
  if (!lista.includes(r.status)) throw new Error(`${r.operationId}: esperado HTTP ${lista.join('/')}, veio ${r.status}: ${JSON.stringify(r.body)?.slice(0, 600)}`);
  if (codigo && (r.body as any)?.codigo !== codigo) throw new Error(`${r.operationId}: esperado codigo ${codigo}, veio ${(r.body as any)?.codigo}`);
  return r;
}
