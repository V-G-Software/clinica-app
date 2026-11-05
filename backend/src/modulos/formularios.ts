// Formulários (9.2). Versão publicada nunca muda (RN-FRM-001): editar cria uma versão nova.
import { novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { invalido, naoEncontrado } from '../erros.ts';
import { C, criado, ok, type Handler } from '../http.ts';
import { conferirIfMatch, ehEquipeCtx, etag, exigir, iso, lerCursor, pagina } from '../nucleo.ts';

export async function formularioVersao(tx: Tx, orgId: string, id: string, versao?: number) {
  return um(tx, `SELECT * FROM formularios WHERE organizacao_id = $1 AND id = $2 ${versao ? 'AND versao = $3' : 'ORDER BY versao DESC LIMIT 1'}`, versao ? [orgId, id, versao] : [orgId, id]);
}
function validarFormulario(f: any) {
  const ids = new Set<string>();
  f.campos.forEach((c: any, i: number) => {
    if (ids.has(c.id)) throw invalido(`campos.${i}.id`, 'Identificador repetido.');
    if (c.visivelSe && !ids.has(c.visivelSe.campo)) throw invalido(`campos.${i}.visivelSe.campo`, 'A condição deve citar um campo anterior.');
    if (c.opcoes && new Set(c.opcoes.map((o: any) => o.valor)).size !== c.opcoes.length) throw invalido(`campos.${i}.opcoes`, 'Valores de opção repetidos.');
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) throw invalido(`campos.${i}.min`, 'min maior que max.');
    ids.add(c.id);
  });
}
const ser = (f: any, podeEditar: boolean) => ({ id: f.id, versao: f.versao, titulo: f.titulo, finalidade: f.finalidade, campos: f.campos, publicadoEm: iso(f.publicado_em), acoesPermitidas: podeEditar ? ['EDITAR'] : [] });

export const handlersFormularios: Record<string, Handler> = {
  formulariosListar: async (q) => {
    const ctx = C(q);
    exigir(ctx, 'acompanhamento.protocolo.ler');
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    const linhas = await todos(q.tx, `SELECT DISTINCT ON (id) * FROM formularios WHERE organizacao_id = $1 ORDER BY id, versao DESC`, [q.org.id]);
    linhas.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
    const p = pagina(linhas.slice(inicio, inicio + limite + 1), inicio, limite);
    return ok({ ...p, itens: p.itens.map((f) => ser(f, ctx.perms.has('acompanhamento.protocolo.gerenciar'))) });
  },
  formulariosCriar: async (q) => {
    const ctx = C(q);
    exigir(ctx, 'acompanhamento.protocolo.gerenciar');
    validarFormulario(q.body);
    const f = await um(q.tx, `INSERT INTO formularios (organizacao_id, id, versao, titulo, finalidade, campos) VALUES ($1,$2,1,$3,$4,$5) RETURNING *`,
      [q.org.id, novoId('frm'), q.body.titulo, q.body.finalidade ?? 'CHECKIN', JSON.stringify(q.body.campos)]);
    return criado(ser(f, true), { ETag: etag(f!.id, 1) });
  },
  formulariosObter: async (q) => {
    const ctx = C(q);
    if (!ehEquipeCtx(ctx)) throw naoEncontrado('Formulário');
    const f = await formularioVersao(q.tx, q.org.id, q.params.formularioId, q.query.versao);
    if (!f) throw naoEncontrado('Formulário');
    const ultima = await formularioVersao(q.tx, q.org.id, f.id);
    return ok(ser(f, ctx.perms.has('acompanhamento.protocolo.gerenciar')), { ETag: etag(f.id, ultima!.versao) });
  },
  formulariosPublicarVersao: async (q) => {
    const ctx = C(q);
    exigir(ctx, 'acompanhamento.protocolo.gerenciar');
    const atual = await formularioVersao(q.tx, q.org.id, q.params.formularioId);
    if (!atual) throw naoEncontrado('Formulário');
    conferirIfMatch(q.headers['if-match'], atual.id, atual.versao, () => ser(atual, true));
    validarFormulario(q.body);
    const f = await um(q.tx, `INSERT INTO formularios (organizacao_id, id, versao, titulo, finalidade, campos) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [q.org.id, atual.id, atual.versao + 1, q.body.titulo, q.body.finalidade ?? atual.finalidade, JSON.stringify(q.body.campos)]);
    return ok(ser(f, true), { ETag: etag(f!.id, f!.versao) });
  },
};
