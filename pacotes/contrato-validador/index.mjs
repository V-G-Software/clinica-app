// Validador do contrato: compila os schemas do openapi.yaml com Ajv (JSON Schema 2020-12).
// Usado pelo mock (requisição e resposta), pela suíte de conformidade e pelo lint de exemplos.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const caminhoContrato = path.join(raiz, 'contrato/openapi.yaml');
export const contrato = parse(readFileSync(caminhoContrato, 'utf8'));
export const versaoContrato = contrato.info.version;

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
ajv.addKeyword({ keyword: 'x-catalogo-nomes' });
ajv.addKeyword({ keyword: 'x-idempotente' });
ajv.addSchema(contrato, 'contrato');

const esc = (s) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const cache = new Map();
function compilar(ponteiro) {
  let v = cache.get(ponteiro);
  if (!v) {
    v = ajv.compile({ $ref: `contrato#${ponteiro}` });
    cache.set(ponteiro, v);
  }
  return v;
}

const cacheObj = new WeakMap();
function reescreverRefs(x) {
  if (Array.isArray(x)) return x.map(reescreverRefs);
  if (x && typeof x === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(x)) r[k] = k === '$ref' && typeof v === 'string' && v.startsWith('#') ? `contrato${v}` : reescreverRefs(v);
    return r;
  }
  return x;
}
/** Compila um schema embutido (ex.: de parâmetro), reescrevendo refs locais para o contrato. */
function compilarObjeto(schema) {
  let v = cacheObj.get(schema);
  if (!v) {
    v = ajv.compile(reescreverRefs(schema));
    cacheObj.set(schema, v);
  }
  return v;
}

function resolverRef(obj) {
  while (obj && obj.$ref) {
    const partes = obj.$ref.replace(/^#\//, '').split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    obj = partes.reduce((o, k) => o?.[k], contrato);
  }
  return obj;
}

/** Operações do contrato indexadas por operationId. */
export const operacoes = {};
for (const [caminho, item] of Object.entries(contrato.paths)) {
  for (const metodo of ['get', 'post', 'put', 'patch', 'delete']) {
    const op = item[metodo];
    if (!op) continue;
    const parametros = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(resolverRef);
    operacoes[op.operationId] = {
      operationId: op.operationId,
      metodo: metodo.toUpperCase(),
      caminho,
      tag: op.tags?.[0],
      publico: Array.isArray(op.security) && op.security.length === 0,
      idempotente: op['x-idempotente'] === true,
      exigeIfMatch: parametros.some((p) => p.in === 'header' && p.name === 'If-Match' && p.required),
      parametros,
      ponteiro: `/paths/${esc(caminho)}/${metodo}`,
      op,
    };
  }
}

function formatarErros(erros) {
  return (erros ?? []).map((e) => ({
    campo: (e.instancePath || '').replace(/^\//, '').replace(/\//g, '.') || (e.params?.missingProperty ?? ''),
    codigo: e.keyword === 'required' ? 'OBRIGATORIO' : 'INVALIDO',
    mensagem: `${e.instancePath || '(raiz)'} ${e.message}${e.params?.missingProperty ? ` (${e.params.missingProperty})` : ''}${e.params?.allowedValues ? ` ${JSON.stringify(e.params.allowedValues)}` : ''}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`,
  }));
}

/** Valida um valor contra `components.schemas[nome]`. */
export function validarSchema(nome, valor) {
  const v = compilar(`/components/schemas/${esc(nome)}`);
  return v(valor) ? { ok: true, erros: [] } : { ok: false, erros: formatarErros(v.errors) };
}

function converter(valor, schema) {
  if (valor === undefined) return valor;
  const s = resolverRef(schema) ?? {};
  const tipos = [].concat(s.type ?? []);
  if (tipos.includes('integer') || tipos.includes('number')) {
    const n = Number(valor);
    return Number.isNaN(n) ? valor : n;
  }
  if (tipos.includes('boolean')) return valor === 'true' ? true : valor === 'false' ? false : valor;
  return valor;
}

/**
 * Valida requisição: parâmetros de path, query e header, e corpo JSON.
 * Devolve { ok, erros, query } com a query já convertida para os tipos do contrato.
 */
export function validarRequisicao(operationId, { params = {}, query = {}, headers = {}, body, temCorpo }) {
  const o = operacoes[operationId];
  const erros = [];
  const queryConvertida = {};
  for (const p of o.parametros) {
    let valor =
      p.in === 'path' ? params[p.name] : p.in === 'query' ? query[p.name] : headers[p.name.toLowerCase()];
    if (valor === undefined || valor === '') {
      if (p.required) erros.push({ campo: p.name, codigo: 'OBRIGATORIO', mensagem: `${p.name} é obrigatório` });
      continue;
    }
    valor = converter(valor, p.schema);
    if (p.in === 'query') queryConvertida[p.name] = valor;
    const v = compilarObjeto(p.schema);
    if (!v(valor)) erros.push(...formatarErros(v.errors).map((e) => ({ ...e, campo: p.name })));
  }
  const rb = resolverRef(o.op.requestBody);
  if (rb) {
    const schema = rb.content?.['application/json']?.schema;
    if (body === undefined || body === null || !temCorpo) {
      if (rb.required) erros.push({ campo: '(corpo)', codigo: 'OBRIGATORIO', mensagem: 'corpo JSON é obrigatório' });
    } else if (schema) {
      const v = compilar(`${o.ponteiro}/requestBody/content/application~1json/schema`);
      if (!v(body)) erros.push(...formatarErros(v.errors));
    }
  }
  return { ok: erros.length === 0, erros, query: queryConvertida };
}

/** Valida uma resposta contra o contrato (status declarado ou `default`). */
export function validarResposta(operationId, status, contentType, body) {
  const o = operacoes[operationId];
  const respostas = o.op.responses;
  const chave = respostas[String(status)] ? String(status) : respostas[`${String(status)[0]}XX`] ? `${String(status)[0]}XX` : 'default';
  const r = resolverRef(respostas[chave]);
  if (!r) return { ok: false, erros: [{ campo: 'status', codigo: 'INVALIDO', mensagem: `status ${status} não declarado` }] };
  if (chave === 'default' && status < 400)
    return { ok: false, erros: [{ campo: 'status', codigo: 'INVALIDO', mensagem: `status de sucesso ${status} não declarado` }] };
  if (!r.content) {
    return body === undefined || body === '' || body === null
      ? { ok: true, erros: [] }
      : { ok: false, erros: [{ campo: '(corpo)', codigo: 'INVALIDO', mensagem: `status ${status} não tem corpo` }] };
  }
  const tipos = Object.keys(r.content);
  const ct = (contentType ?? '').split(';')[0].trim();
  if (!tipos.includes(ct))
    return { ok: false, erros: [{ campo: 'content-type', codigo: 'INVALIDO', mensagem: `content-type "${ct}" não está em ${tipos.join(', ')}` }] };
  if (ct === 'text/event-stream') return { ok: true, erros: [] };
  const base = respostas[chave].$ref ? respostas[chave].$ref.slice(1) : `${o.ponteiro}/responses/${esc(chave)}`;
  const v = compilar(`${base}/content/${esc(ct)}/schema`);
  return v(body) ? { ok: true, erros: [] } : { ok: false, erros: formatarErros(v.errors) };
}

/** Converte `/v1/x/{id}` em regex e devolve o operationId que casa com método e caminho. */
const rotas = Object.values(operacoes).map((o) => ({
  ...o,
  regex: new RegExp(`^${o.caminho.replace(/\{([^}]+)\}/g, '(?<$1>[^/]+)')}$`),
}));
export function encontrarOperacao(metodo, caminho) {
  // Rotas literais têm prioridade sobre parametrizadas (ex.: /v1/pacientes/busca).
  const candidatas = rotas.filter((r) => r.metodo === metodo && r.regex.test(caminho));
  candidatas.sort((a, b) => (a.caminho.match(/\{/g)?.length ?? 0) - (b.caminho.match(/\{/g)?.length ?? 0));
  const r = candidatas[0];
  return r ? { operacao: r, params: { ...caminho.match(r.regex).groups } } : null;
}
