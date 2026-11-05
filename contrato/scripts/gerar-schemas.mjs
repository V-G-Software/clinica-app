// Gera contrato/schemas/*.schema.json (JSON Schema 2020-12) a partir do openapi.yaml.
// O YAML é a fonte da verdade; os arquivos gerados servem a quem implementa um backend em outra stack
// e ao frontend (catálogos fechados). Não edite os .schema.json à mão.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrato } from '@clinica/contrato-validador';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../schemas');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const S = contrato.components.schemas;
const BASE = 'https://exemplo.com.br/contrato/v1/';

/** Coleta, recursivamente, os componentes referenciados por um schema. */
function dependencias(nome, vistos = new Set()) {
  if (vistos.has(nome)) return vistos;
  vistos.add(nome);
  JSON.stringify(S[nome], (k, v) => {
    if (k === '$ref' && typeof v === 'string') dependencias(v.split('/').pop(), vistos);
    return v;
  });
  return vistos;
}
function emitir(arquivo, raiz, titulo) {
  const defs = {};
  for (const d of dependencias(raiz)) if (d !== raiz) defs[d] = S[d];
  const doc = JSON.parse(JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `${BASE}${arquivo}`, title: titulo,
    'x-gerado-de': `contrato/openapi.yaml#/components/schemas/${raiz} (${contrato.info.version})`,
    ...S[raiz], ...(Object.keys(defs).length ? { $defs: defs } : {}),
  }).replaceAll('#/components/schemas/', '#/$defs/'));
  writeFileSync(path.join(dir, arquivo), JSON.stringify(doc, null, 2) + '\n');
}

const principais = {
  'manifesto.schema.json': ['Manifesto', 'Manifesto da sessão (GET /v1/sessao)'],
  'configuracao-publica.schema.json': ['ConfiguracaoPublica', 'Configuração pública (GET /v1/publico/configuracao)'],
  'diretorio.schema.json': ['OrganizacaoDiretorio', 'Organização resolvida no diretório'],
  'formulario.schema.json': ['Formulario', 'Formulário (check-in e cadastro)'],
  'protocolo.schema.json': ['Protocolo', 'Protocolo de acompanhamento'],
  'evento.schema.json': ['Evento', 'Evento de tempo real (SSE e GET /v1/eventos)'],
  'problema.schema.json': ['Problema', 'Erro RFC 9457 com codigo estável'],
  'inicio.schema.json': ['Inicio', 'Tela inicial (GET /v1/inicio)'],
};
for (const [arq, [raiz, titulo]] of Object.entries(principais)) emitir(arq, raiz, titulo);

// Catálogos fechados da v1 (7.2): um arquivo com todas as listas, para o frontend e para backends.
const catalogos = ['Perfil', 'ModuloId', 'Tela', 'TermoChave', 'ContadorChave', 'Icone', 'CodigoErro', 'TipoNotificacao', 'TipoEvento', 'TipoSecao', 'Etapa', 'Permissao', 'TipoCampo', 'Operador', 'Severidade', 'StatusOrganizacao', 'TipoMensagem'];
writeFileSync(path.join(dir, 'catalogos.json'), JSON.stringify({
  'x-gerado-de': `contrato/openapi.yaml (${contrato.info.version})`,
  ...Object.fromEntries(catalogos.map((c) => [c, S[c].enum])),
}, null, 2) + '\n');
console.log(`schemas gerados em ${path.relative(process.cwd(), dir)}: ${Object.keys(principais).length} schemas + catalogos.json`);
