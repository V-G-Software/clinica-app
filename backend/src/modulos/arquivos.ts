// Arquivos (8.3): iniciar → bytes direto para o storage → concluir → validação e higiene → DISPONIVEL.
import { novoId } from '../cripto.ts';
import { um } from '../db.ts';
import { emitir } from '../eventos.ts';
import { ErroApi, naoEncontrado } from '../erros.ts';
import { C, criado, ok, type Handler } from '../http.ts';
import { exigir, iso, type Ctx } from '../nucleo.ts';
import { ASSINATURAS, recodificar } from '../servicos/imagem.ts';
import { storage } from '../servicos/storage.ts';
import type { Tx } from '../db.ts';

const VISUALIZACAO_MS = 5 * 60_000;
export async function urlsArquivo(a: any) {
  if (a.status !== 'DISPONIVEL') return { urlVisualizacao: null, urlMiniatura: null, urlsExpiramEm: null };
  const exp = Date.now() + VISUALIZACAO_MS;
  const chave = `final/${a.organizacao_id}/${a.id}`;
  return { urlVisualizacao: await storage.urlVisualizacao(chave, exp), urlMiniatura: await storage.urlVisualizacao(`${chave}.mini`, exp), urlsExpiramEm: iso(new Date(exp)) };
}
export async function serArquivo(a: any) {
  return { id: a.id, nome: a.nome, tipo: a.tipo, tamanhoBytes: Number(a.tamanho_bytes), finalidade: a.finalidade, status: a.status, motivoRejeicao: a.motivo_rejeicao ?? null, ...(await urlsArquivo(a)), criadoEm: iso(a.criado_em) };
}
/** Quem vê o arquivo: o dono; arquivos de perfil/organização; participante ativo da conversa em que foi
 *  enviado; quem vê o check-in em que foi usado (equipe com permissão ou conta vinculada ao paciente). */
async function obterVisivel(tx: Tx, ctx: Ctx, id: string) {
  const a = await um(tx, 'SELECT * FROM arquivos WHERE organizacao_id = $1 AND id = $2', [ctx.org.id, id]);
  if (!a) throw naoEncontrado('Arquivo');
  if (a.dono_id === ctx.usuario.id || a.finalidade === 'PERFIL' || a.finalidade === 'ORGANIZACAO') return a;
  if (a.conversa_id && await um(tx, 'SELECT 1 FROM participantes WHERE organizacao_id = $1 AND conversa_id = $2 AND usuario_id = $3 AND removido_em IS NULL', [ctx.org.id, a.conversa_id, ctx.usuario.id])) return a;
  if (a.checkin_id && ctx.perms.has('acompanhamento.checkin.ler')) {
    const c = await um(tx, 'SELECT paciente_id FROM checkins WHERE organizacao_id = $1 AND id = $2', [ctx.org.id, a.checkin_id]);
    if (c && (ctx.perfil !== 'PACIENTE' || await um(tx, 'SELECT 1 FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $2 AND paciente_id = $3', [ctx.org.id, ctx.usuario.id, c.paciente_id]))) return a;
  }
  throw naoEncontrado('Arquivo');
}

export const handlersArquivos: Record<string, Handler> = {
  arquivosIniciarEnvio: async (q) => {
    const ctx = C(q);
    const cap = q.org.capacidades.upload;
    if (!cap.tiposPermitidos.includes(q.body.tipo)) throw new ErroApi('TIPO_ARQUIVO_NAO_PERMITIDO', `Envie ${cap.tiposPermitidos.join(', ')}.`);
    if (q.body.tamanhoBytes > cap.tamanhoMaximoBytes) throw new ErroApi('ARQUIVO_MUITO_GRANDE', `O limite é ${Math.floor(cap.tamanhoMaximoBytes / 1048576)} MB.`);
    if (q.body.finalidade === 'ORGANIZACAO') exigir(ctx, 'organizacao.configuracao.editar');
    const id = novoId('arq');
    const chave = `quarentena/${q.org.id}/${id}`;
    const exp = Date.now() + 15 * 60_000;
    await q.tx.query(`INSERT INTO arquivos (organizacao_id, id, dono_id, nome, tipo, tamanho_bytes, finalidade, status, chave_storage) VALUES ($1,$2,$3,$4,$5,$6,$7,'AGUARDANDO_ENVIO',$8)`,
      [q.org.id, id, ctx.usuario.id, q.body.nome, q.body.tipo, q.body.tamanhoBytes, q.body.finalidade, chave]);
    return criado({ arquivoId: id, envio: await storage.urlEnvio(chave, q.body.tipo, exp), expiraEm: iso(new Date(exp)) });
  },
  arquivosConcluirEnvio: async (q) => {
    const ctx = C(q);
    const a = await um(q.tx, 'SELECT * FROM arquivos WHERE organizacao_id = $1 AND id = $2 AND dono_id = $3 FOR UPDATE', [q.org.id, q.params.arquivoId, ctx.usuario.id]);
    if (!a) throw naoEncontrado('Arquivo');
    if (a.status !== 'AGUARDANDO_ENVIO') return ok(await serArquivo(a));
    // Validação e higiene (14.4): bytes recebidos, tamanho, assinatura do tipo e recodificação completa.
    const bytes = await storage.ler(a.chave_storage);
    const cap = q.org.capacidades.upload;
    let status = 'DISPONIVEL', motivo: string | null = null, limpo: Buffer | null = null;
    if (!bytes) { status = 'REJEITADO'; motivo = 'Arquivo não recebido.'; }
    else if (bytes.length > cap.tamanhoMaximoBytes) { status = 'REJEITADO'; motivo = 'Arquivo maior que o permitido.'; }
    else if (!ASSINATURAS[a.tipo]?.(bytes)) { status = 'REJEITADO'; motivo = 'O conteúdo não corresponde ao tipo informado.'; }
    else {
      try {
        const r = await recodificar(a.tipo, bytes);
        limpo = r.imagem;
        await storage.gravar(`final/${q.org.id}/${a.id}`, r.imagem, a.tipo);
        await storage.gravar(`final/${q.org.id}/${a.id}.mini`, r.miniatura, a.tipo);
      } catch (e: any) {
        status = 'REJEITADO'; motivo = 'Não foi possível ler esta imagem. Tire outra foto e tente de novo.';
        q.log.warn({ arquivo: a.id, err: e?.message }, 'imagem rejeitada na recodificação');
      }
    }
    // O original (com metadados) sai da quarentena: só a versão recodificada fica guardada.
    if (bytes) await storage.remover(a.chave_storage).catch(() => undefined);
    const r = await um(q.tx, 'UPDATE arquivos SET status = $3, motivo_rejeicao = $4, tamanho_bytes = COALESCE($5, tamanho_bytes) WHERE organizacao_id = $1 AND id = $2 RETURNING *',
      [q.org.id, a.id, status, motivo, limpo?.length ?? null]);
    await emitir(q.tx, q.org.id, 'arquivo.processado', { arquivoId: a.id, status }, [ctx.usuario.id]);
    return ok(await serArquivo(r));
  },
  arquivosObter: async (q) => ok(await serArquivo(await obterVisivel(q.tx, C(q), q.params.arquivoId))),
};
