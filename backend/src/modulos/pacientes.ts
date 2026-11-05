// Pacientes (9.1). Visibilidade: equipe vê a organização; paciente, só os vinculados à conta (404 no resto).
import { configModulo, normalizar, validarRespostas } from '@clinica/dominio';
import { novoId, sha256, tokenAleatorio } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { ErroApi, invalido, naoEncontrado } from '../erros.ts';
import { C, criado, ok, type Handler } from '../http.ts';
import { auditar, conferirIfMatch, ehEquipeCtx, etag, exigir, exigirModulo, iso, lerCursor, pagina, type Ctx } from '../nucleo.ts';
import { serPaciente } from '../serializar.ts';
import { enviarEmail } from '../servicos/email.ts';
import { formularioVersao } from './formularios.ts';

const URL_FRONTEND = (process.env.URL_FRONTEND ?? 'http://localhost:5173').replace(/\/$/, '');

async function visiveis(tx: Tx, ctx: Ctx, where = '', params: unknown[] = [], ordem = 'ORDER BY p.nome, p.id', limite = 100, inicio = 0) {
  exigirModulo(ctx.org, 'pacientes');
  exigir(ctx, 'pacientes.paciente.ler');
  const base = ehEquipeCtx(ctx)
    ? 'SELECT p.* FROM pacientes p WHERE p.organizacao_id = $1'
    : 'SELECT p.* FROM pacientes p JOIN vinculos v ON v.organizacao_id = p.organizacao_id AND v.paciente_id = p.id AND v.usuario_id = $2 WHERE p.organizacao_id = $1';
  const fixos = ehEquipeCtx(ctx) ? [ctx.org.id, null] : [ctx.org.id, ctx.usuario.id];
  return todos(tx, `${base} AND ($2::text IS NULL OR true) ${where} ${ordem} OFFSET ${inicio} LIMIT ${limite}`, [...fixos, ...params]);
}
export async function obterPaciente(tx: Tx, ctx: Ctx, id: string) {
  const [p] = await visiveis(tx, ctx, 'AND p.id = $3', [id], '', 1);
  if (!p) throw naoEncontrado('Paciente');
  return p;
}

async function validar(tx: Tx, ctx: Ctx, p: any) {
  const contatos = [p.contato?.email, p.contato?.celular, ...(p.responsaveis ?? []).flatMap((x: any) => [x.contato?.email, x.contato?.celular])];
  if (!contatos.some(Boolean)) throw invalido('contato', 'Informe ao menos um e-mail ou celular (do paciente ou de um responsável).', 'OBRIGATORIO');
  const relacoes: string[] = configModulo(ctx.org.modulos, 'pacientes').relacoesPermitidas ?? [];
  if (p.tipo === 'ANIMAL' && !relacoes.includes('ANIMAL')) throw invalido('tipo', 'Esta organização não atende animais.');
  if (p.tipo === 'PESSOA' && !relacoes.some((x) => x !== 'ANIMAL')) throw invalido('tipo', 'Esta organização atende apenas animais.');
  if (p.tipo === 'ANIMAL' && !(p.responsaveis ?? []).length) throw invalido('responsaveis', 'Informe o tutor.', 'OBRIGATORIO');
  const formId = configModulo(ctx.org.modulos, 'pacientes').formularioCadastroId;
  const form = formId ? await formularioVersao(tx, ctx.org.id, formId) : null;
  if (form) {
    const erros = validarRespostas(form.campos, p.camposAdicionais ?? {}, 'camposAdicionais');
    if (erros.length) throw new ErroApi('VALIDACAO_FALHOU', 'Alguns campos precisam de correção.', { campos: erros });
  } else if (Object.keys(p.camposAdicionais ?? {}).length) throw invalido('camposAdicionais', 'Esta organização não usa campos adicionais.');
}

export const handlersPacientes: Record<string, Handler> = {
  pacientesListar: async (q) => {
    const ctx = C(q);
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    const linhas = await visiveis(q.tx, ctx, q.query.status ? 'AND p.status = $3' : '', q.query.status ? [q.query.status] : [], 'ORDER BY p.nome, p.id', limite + 1, inicio);
    const p = pagina(linhas, inicio, limite);
    return ok({ ...p, itens: await Promise.all(p.itens.map((x) => serPaciente(q.tx, ctx, x))) });
  },
  pacientesBuscar: async (q) => {
    const ctx = C(q);
    const limite = q.body.limite ?? 20;
    const inicio = lerCursor(q.body.cursor);
    const t = `%${normalizar(q.body.texto).replace(/[%_\\]/g, '\\$&')}%`;
    const digitos = String(q.body.texto).replace(/\D/g, '');
    const linhas = await visiveis(q.tx, ctx, `AND (p.nome_busca LIKE $3 OR lower(p.contato->>'email') LIKE $3 OR ($4 <> '' AND length($4) >= 4 AND p.contato->>'celular' LIKE '%' || $4 || '%'))`, [t, digitos], 'ORDER BY p.nome, p.id', limite + 1, inicio);
    // A busca é auditada como leitura (o texto nunca vai para a URL nem para o log).
    await auditar(q.tx, q.org.id, { usuarioId: ctx.usuario.id, acao: 'BUSCAR', recurso: 'paciente', ip: q.ip, requestId: q.requestId });
    const p = pagina(linhas, inicio, limite);
    return ok({ ...p, itens: await Promise.all(p.itens.map((x) => serPaciente(q.tx, ctx, x))) });
  },
  pacientesCriar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'pacientes');
    exigir(ctx, 'pacientes.paciente.criar');
    await validar(q.tx, ctx, q.body);
    const id = novoId('pac');
    const p = await um(q.tx, `INSERT INTO pacientes (organizacao_id, id, tipo, nome, nome_social, data_nascimento, contato, campos_adicionais, responsaveis, nome_busca)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [q.org.id, id, q.body.tipo, q.body.nome, q.body.nomeSocial ?? null, q.body.dataNascimento ?? null,
      q.body.contato ?? {}, q.body.camposAdicionais ?? {}, JSON.stringify(q.body.responsaveis ?? []), normalizar(`${q.body.nome} ${q.body.nomeSocial ?? ''}`)]);
    await auditar(q.tx, q.org.id, { usuarioId: ctx.usuario.id, acao: 'CRIAR', recurso: 'paciente', recursoId: id, ip: q.ip, requestId: q.requestId });
    return criado(await serPaciente(q.tx, ctx, p), { ETag: etag(id, 1) });
  },
  pacientesObter: async (q) => {
    const ctx = C(q);
    const p = await obterPaciente(q.tx, ctx, q.params.pacienteId);
    await auditar(q.tx, q.org.id, { usuarioId: ctx.usuario.id, acao: 'LER', recurso: 'paciente', recursoId: p.id, ip: q.ip, requestId: q.requestId });
    return ok(await serPaciente(q.tx, ctx, p), { ETag: etag(p.id, p.versao) });
  },
  pacientesEditar: async (q) => {
    const ctx = C(q);
    const p = await obterPaciente(q.tx, ctx, q.params.pacienteId);
    exigir(ctx, 'pacientes.paciente.editar');
    const atual = await serPaciente(q.tx, ctx, p);
    conferirIfMatch(q.headers['if-match'], p.id, p.versao, () => atual);
    const novo = { tipo: p.tipo, contato: atual.contato, responsaveis: atual.responsaveis, camposAdicionais: atual.camposAdicionais, ...q.body };
    await validar(q.tx, ctx, novo);
    const nome = q.body.nome ?? p.nome;
    const nomeSocial = 'nomeSocial' in q.body ? q.body.nomeSocial : p.nome_social;
    const r = await um(q.tx, `UPDATE pacientes SET nome = $3, nome_social = $4, data_nascimento = $5, contato = $6, campos_adicionais = $7, responsaveis = $8, status = $9, nome_busca = $10, versao = versao + 1
      WHERE organizacao_id = $1 AND id = $2 AND versao = $11 RETURNING *`, [q.org.id, p.id, nome, nomeSocial, 'dataNascimento' in q.body ? q.body.dataNascimento : p.data_nascimento,
      novo.contato, novo.camposAdicionais, JSON.stringify(novo.responsaveis), q.body.status ?? p.status, normalizar(`${nome} ${nomeSocial ?? ''}`), p.versao]);
    if (!r) throw new ErroApi('CONFLITO_VERSAO', 'Recarregue e tente de novo.', { estadoAtual: atual }); // corrida entre dois PATCH
    await auditar(q.tx, q.org.id, { usuarioId: ctx.usuario.id, acao: 'ALTERAR', recurso: 'paciente', recursoId: p.id, ip: q.ip, requestId: q.requestId });
    return ok(await serPaciente(q.tx, ctx, r), { ETag: etag(r.id, r.versao) });
  },
  pacientesConvidar: async (q) => {
    const ctx = C(q);
    const p = await obterPaciente(q.tx, ctx, q.params.pacienteId);
    exigir(ctx, 'pacientes.paciente.convidar');
    if (p.status !== 'ATIVO') throw invalido('status', 'Reative o paciente antes de convidar.');
    const email = q.body.email ?? p.contato?.email ?? p.responsaveis?.find((x: any) => x.contato?.email)?.contato.email ?? null;
    if (q.body.enviarEmail && !email) throw invalido('email', 'Informe um e-mail para enviar o convite.', 'OBRIGATORIO');
    const resp = (p.responsaveis ?? []).find((x: any) => x.contato?.email && x.contato.email === email);
    const relacao = p.tipo === 'ANIMAL' ? 'ANIMAL' : resp || (p.responsaveis?.length && email !== p.contato?.email) ? 'DEPENDENTE' : 'PROPRIO';
    if (!(configModulo(q.org.modulos, 'pacientes').relacoesPermitidas ?? []).includes(relacao)) throw invalido('email', `Vínculo ${relacao} não permitido nesta organização.`);
    await q.tx.query('UPDATE convites SET revogado_em = now() WHERE organizacao_id = $1 AND paciente_id = $2 AND usado_em IS NULL AND revogado_em IS NULL', [q.org.id, p.id]);
    const token = tokenAleatorio(18);
    const id = novoId('cnt');
    const c = await um(q.tx, `INSERT INTO convites (organizacao_id, id, token_hash, tipo, paciente_id, email, relacao, nome, nome_conta, criado_por, expira_em)
      VALUES ($1,$2,$3,'PACIENTE',$4,$5,$6,$7,$8,$9, now() + interval '7 days') RETURNING expira_em`, [q.org.id, id, sha256(token), p.id, email, relacao, p.nome, resp?.nome ?? p.nome, ctx.usuario.id]);
    const link = `${URL_FRONTEND}/convite/${token}?org=${q.org.slug}`;
    if (q.body.enviarEmail) enviarEmail({ org: q.org.slug, para: email, assunto: `Convite — ${q.org.nome}`, texto: `Você foi convidado para o app da ${q.org.nome}. Acesse: ${link}` }, q.log);
    return criado({ id, token, link, conteudoQr: link, expiraEm: iso(c!.expira_em), emailEnviado: !!q.body.enviarEmail });
  },
};
