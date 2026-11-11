// Arquivos (8.3): iniciar → bytes direto para o storage → concluir → validação e higiene → DISPONIVEL.
import { novoId } from '../cripto.ts';
import { um } from '../db.ts';
import { emitir } from '../eventos.ts';
import { ErroApi, invalido, naoEncontrado, negado } from '../erros.ts';
import { C, criado, ok, type Handler } from '../http.ts';
import { exigir, exigirModulo, iso, type Ctx, type Org } from '../nucleo.ts';
import { ASSINATURAS, recodificar } from '../servicos/imagem.ts';
import { AntivirusIndisponivel, verificar } from '../servicos/antivirus.ts';
import { cfgExames, tiposPermitidos } from '../servicos/exames.ts';
import { agendar, registrarJob } from '../servicos/jobs.ts';
import { ehPdf, PdfInvalido, sanear } from '../servicos/pdf.ts';
import { orgPorId } from '../servicos/refs.ts';
import type { Log } from '../http.ts';
import { storage } from '../servicos/storage.ts';
import type { Tx } from '../db.ts';

const VISUALIZACAO_MS = 5 * 60_000;
export async function urlsArquivo(a: any) {
  if (a.status !== 'DISPONIVEL') return { urlVisualizacao: null, urlMiniatura: null, urlsExpiramEm: null };
  const exp = Date.now() + VISUALIZACAO_MS;
  const chave = `final/${a.organizacao_id}/${a.id}`;
  // PDF (ADR-0017): sempre como anexo, com o tipo fixado na URL assinada; sem miniatura no MVP.
  if (a.tipo === 'application/pdf')
    return { urlVisualizacao: await storage.urlVisualizacao(chave, exp, { nome: a.nome, tipo: a.tipo }), urlMiniatura: null, urlsExpiramEm: iso(new Date(exp)) };
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
  // PDF de documento assinado (ADR-0018): quem vê o documento (equipe com permissão; paciente vinculado, só assinado/anulado).
  if (a.finalidade === 'DOCUMENTO' && ctx.perms.has('documentos.documento.ler')) {
    const d = await um(tx, `SELECT paciente_id, status FROM documentos WHERE organizacao_id = $1 AND arquivo_id = $2`, [ctx.org.id, a.id]);
    if (d && (ctx.perfil !== 'PACIENTE' || ((d.status === 'ASSINADO' || d.status === 'ANULADO')
      && await um(tx, 'SELECT 1 FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $2 AND paciente_id = $3', [ctx.org.id, ctx.usuario.id, d.paciente_id])))) return a;
  }
  // Arquivo de resultado de exame: quem vê o resultado (RN-EXA-001).
  if (a.finalidade === 'EXAME' && ctx.perms.has('exames.exame.ler')) {
    const x = await um(tx, `SELECT r.paciente_id FROM resultado_arquivos ra JOIN resultados_exame r ON r.organizacao_id = ra.organizacao_id AND r.id = ra.resultado_id
                            WHERE ra.organizacao_id = $1 AND ra.arquivo_id = $2`, [ctx.org.id, a.id]);
    if (x && (ctx.perfil !== 'PACIENTE' || await um(tx, 'SELECT 1 FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $2 AND paciente_id = $3', [ctx.org.id, ctx.usuario.id, x.paciente_id]))) return a;
  }
  throw naoEncontrado('Arquivo');
}

export const handlersArquivos: Record<string, Handler> = {
  arquivosIniciarEnvio: async (q) => {
    const ctx = C(q);
    const cap = q.org.capacidades.upload;
    if (q.body.finalidade === 'DOCUMENTO') throw invalido('finalidade', 'Documentos são gerados pelo servidor.');
    if (q.body.finalidade === 'EXAME') {
      exigirModulo(q.org, 'exames');
      exigir(ctx, 'exames.resultado.enviar');
      if (ctx.perfil === 'PACIENTE' && !cfgExames(q.org).pacienteEnviaResultados) throw negado();
    }
    const tipos = tiposPermitidos(q.org, q.body.finalidade); // PDF só em EXAME e só com antivírus (ADR-0017)
    if (!tipos.includes(q.body.tipo)) throw new ErroApi('TIPO_ARQUIVO_NAO_PERMITIDO', `Envie ${tipos.join(', ')}.`);
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
    const r = await processar(q.tx, q.org, a, q.log);
    if (r.status !== 'PROCESSANDO') await emitir(q.tx, q.org.id, 'arquivo.processado', { arquivoId: a.id, status: r.status }, [ctx.usuario.id]);
    return ok(await serArquivo(r));
  },
  arquivosObter: async (q) => ok(await serArquivo(await obterVisivel(q.tx, C(q), q.params.arquivoId))),
};

/**
 * Validação e higiene (14.4 / ADR-0015 / ADR-0017): bytes recebidos, tamanho, assinatura do tipo e então
 *  - imagem: recodificação completa (sharp);
 *  - PDF: antivírus no original e saneamento (documento novo, sem JavaScript, anexos nem formulários).
 * O original sai da quarentena em qualquer desfecho final. Com o antivírus fora do ar, o arquivo fica
 * PROCESSANDO e um job tenta de novo (o original continua na quarentena até lá).
 */
async function processar(tx: Tx, org: Org, a: any, log: Log) {
  const bytes = await storage.ler(a.chave_storage);
  const cap = org.capacidades.upload;
  let status = 'DISPONIVEL', motivo: string | null = null, tamanho: number | null = null;
  if (!bytes) { status = 'REJEITADO'; motivo = 'Arquivo não recebido.'; }
  else if (bytes.length > cap.tamanhoMaximoBytes) { status = 'REJEITADO'; motivo = 'Arquivo maior que o permitido.'; }
  else if (a.tipo === 'application/pdf') {
    if (!ehPdf(bytes)) { status = 'REJEITADO'; motivo = 'O conteúdo não corresponde ao tipo informado.'; }
    else {
      try {
        const v = await verificar(bytes);
        if (!v.limpo) {
          status = 'REJEITADO'; motivo = 'O arquivo foi recusado pela verificação de segurança.';
          log.warn({ arquivo: a.id, assinatura: v.assinatura }, 'antivírus recusou arquivo');
        } else {
          const { pdf } = await sanear(bytes);
          tamanho = pdf.length;
          await storage.gravar(`final/${org.id}/${a.id}`, pdf, a.tipo);
        }
      } catch (e: any) {
        if (e instanceof AntivirusIndisponivel) {
          log.error({ arquivo: a.id, err: e.message }, 'antivírus indisponível; nova tentativa agendada');
          await agendar(tx, org.id, `arquivo:${a.id}:processar`, 'arquivo.processar', Date.now() + 60_000, { arquivoId: a.id });
          return (await um(tx, `UPDATE arquivos SET status = 'PROCESSANDO' WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [org.id, a.id]))!;
        }
        status = 'REJEITADO';
        motivo = e instanceof PdfInvalido ? `Não foi possível usar este PDF: ${e.message}` : 'Não foi possível ler este PDF.';
        log.warn({ arquivo: a.id, err: e?.message }, 'PDF rejeitado no saneamento');
      }
    }
  } else if (!ASSINATURAS[a.tipo]?.(bytes)) { status = 'REJEITADO'; motivo = 'O conteúdo não corresponde ao tipo informado.'; }
  else {
    try {
      const r = await recodificar(a.tipo, bytes);
      tamanho = r.imagem.length;
      await storage.gravar(`final/${org.id}/${a.id}`, r.imagem, a.tipo);
      await storage.gravar(`final/${org.id}/${a.id}.mini`, r.miniatura, a.tipo);
    } catch (e: any) {
      status = 'REJEITADO'; motivo = 'Não foi possível ler esta imagem. Tire outra foto e tente de novo.';
      log.warn({ arquivo: a.id, err: e?.message }, 'imagem rejeitada na recodificação');
    }
  }
  // O original (com metadados, ou com o conteúdo ativo do PDF) sai da quarentena.
  if (bytes) await storage.remover(a.chave_storage).catch(() => undefined);
  return (await um(tx, 'UPDATE arquivos SET status = $3, motivo_rejeicao = $4, tamanho_bytes = COALESCE($5, tamanho_bytes) WHERE organizacao_id = $1 AND id = $2 RETURNING *',
    [org.id, a.id, status, motivo, tamanho]))!;
}

registrarJob('arquivo.processar', async (tx, orgId, { arquivoId }, log) => {
  const a = await um(tx, `SELECT * FROM arquivos WHERE organizacao_id = $1 AND id = $2 AND status = 'PROCESSANDO' FOR UPDATE`, [orgId, arquivoId]);
  if (!a) return; // idempotente: já processado
  const r = await processar(tx, await orgPorId(orgId), a, log);
  if (r.status !== 'PROCESSANDO') await emitir(tx, orgId, 'arquivo.processado', { arquivoId, status: r.status }, [a.dono_id]);
});
