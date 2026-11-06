// Valida contrato/exemplos: respostas capturadas (exemplos/respostas/<operationId>[.n].json) contra a
// resposta da operação, e as partes dos cenários que seguem schemas do contrato.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrato, operacoes, validarResposta, validarSchema } from '@clinica/contrato-validador';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let falhas = 0, total = 0;
const checar = (rotulo, r) => { total++; if (!r.ok) { falhas++; console.error(`✗ ${rotulo}\n  - ${r.erros.map((e) => e.mensagem).join('\n  - ')}`); } };

const dirResp = path.join(raiz, 'exemplos/respostas');
if (existsSync(dirResp)) for (const arq of readdirSync(dirResp).filter((f) => f.endsWith('.json'))) {
  const ex = JSON.parse(readFileSync(path.join(dirResp, arq), 'utf8'));
  const op = arq.split('.')[0];
  if (!operacoes[op]) { falhas++; console.error(`✗ ${arq}: operationId ${op} não existe`); continue; }
  checar(`respostas/${arq}`, validarResposta(op, ex.status, ex.contentType, ex.corpo));
}

const ignorar = (o) => { const { $comentario, ...r } = o; return r; };
for (const arq of readdirSync(path.join(raiz, 'exemplos/cenarios')).filter((f) => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(path.join(raiz, 'exemplos/cenarios', arq), 'utf8'));
  const o = c.organizacao;
  checar(`${arq}: tema`, validarSchema('Tema', o.tema));
  checar(`${arq}: contato`, validarSchema('ContatoOrganizacao', o.contato));
  for (const [k, t] of Object.entries(c.termos)) checar(`${arq}: termo ${k}`, validarSchema('Termo', t));
  // Todo termo do catálogo precisa estar no cenário (o catálogo cresce com os módulos: `consulta` veio na 1.1).
  const faltando = contrato.components.schemas.TermoChave.enum.find((k) => !(k in c.termos));
  checar(`${arq}: termos completos`, validarSchema('TermoChave', faltando ? `faltando:${faltando}` : 'organizacao'));
  for (const m of c.modulos) checar(`${arq}: módulo ${m.id}`, validarSchema('Modulo', m));
  checar(`${arq}: capacidades`, validarSchema('Capacidades', c.capacidades));
  for (const f of c.formularios) checar(`${arq}: formulário ${f.id}`, validarSchema('Formulario', ignorar(f)));
  for (const p of c.protocolos) checar(`${arq}: protocolo ${p.id}`, validarSchema('Protocolo', { ...ignorar(p), acoesPermitidas: [] }));
}
console.log(`${total - falhas}/${total} exemplos válidos`);
process.exit(falhas ? 1 : 0);
