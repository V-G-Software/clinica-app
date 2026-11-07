// Módulo `exames` (ADR-0017): pedidos, resultados (imagem e PDF), revisão e o que a organização sem o
// módulo não vê. PDF só na finalidade EXAME; com a assinatura de teste EICAR, o antivírus recusa.
import { beforeAll, describe, expect, it } from 'vitest';
import { type Cliente, esperar } from '../src/cliente.ts';
import { ambiente, temModulo } from '../src/contexto.ts';
import { gerarPdf, EICAR } from '../src/pdf.ts';
import { gerarPng } from '../src/png.ts';

const amb = ambiente();
const { api, gestor, pacienteA, pacienteB } = amb;
const ativo = temModulo(amb, 'exames');

async function enviar(api: Cliente, token: string, bytes: Buffer, tipo: string, finalidade = 'EXAME') {
  const ini = esperar(await api.chamar('POST', '/v1/arquivos', { token, idempotencia: true, body: { nome: tipo === 'application/pdf' ? 'laudo.pdf' : 'laudo.png', tipo, tamanhoBytes: bytes.length, finalidade } }), 201).body;
  const up = await fetch(ini.envio.url, { method: ini.envio.metodo, headers: ini.envio.cabecalhos, body: new Uint8Array(bytes) });
  expect(up.ok, `envio dos bytes: HTTP ${up.status}`).toBe(true);
  esperar(await api.chamar('POST', `/v1/arquivos/${ini.arquivoId}/concluir`, { token }), 200);
  const limite = Date.now() + 20_000;
  for (;;) {
    const a = esperar(await api.chamar('GET', `/v1/arquivos/${ini.arquivoId}`, { token }), 200).body;
    if (a.status === 'DISPONIVEL' || a.status === 'REJEITADO' || Date.now() > limite) return a;
    await new Promise((ok) => setTimeout(ok, 250));
  }
}

describe.runIf(!ativo)('exames — módulo não contratado', () => {
  it('rotas respondem 404 MODULO_NAO_CONTRATADO, PDF é recusado e o manifesto não mostra nada', async () => {
    esperar(await api.chamar('GET', '/v1/exames/pedidos', { token: gestor.token }), 404, 'MODULO_NAO_CONTRATADO');
    esperar(await api.chamar('GET', '/v1/exames/resultados', { token: pacienteA.token }), 404, 'MODULO_NAO_CONTRATADO');
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(man.permissoes.filter((p: string) => p.startsWith('exames.'))).toEqual([]);
    expect(man.navegacao.filter((n: any) => n.destino.tela.startsWith('exames.'))).toEqual([]);
    const r = await api.chamar('POST', '/v1/arquivos', { token: gestor.token, idempotencia: true, body: { nome: 'laudo.pdf', tipo: 'application/pdf', tamanhoBytes: 1000, finalidade: 'CHECKIN' } });
    expect(r.status).toBe(415);
  });
});

describe.runIf(ativo)('exames', () => {
  let pacienteEnvia: boolean;
  let pedido: any;
  beforeAll(async () => {
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    pacienteEnvia = man.permissoes.includes('exames.resultado.enviar');
    const org = esperar(await api.chamar('GET', '/v1/organizacao', { token: gestor.token }), 200).body;
    expect(org.exames.pacienteEnviaResultados).toBe(pacienteEnvia);
  });

  it('manifesto: permissões, menu, termo e capacidade de PDF em EXAME', async () => {
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(man.permissoes).toEqual(expect.arrayContaining(['exames.exame.ler', 'exames.pedido.criar', 'exames.resultado.enviar', 'exames.resultado.revisar']));
    expect(man.navegacao.some((n: any) => n.destino.tela === 'exames.lista')).toBe(true);
    expect(man.capacidades.upload.tiposPermitidosExame).toContain('application/pdf');
    expect(man.capacidades.upload.tiposPermitidos).not.toContain('application/pdf');
    const manP = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    expect(manP.permissoes).toContain('exames.exame.ler');
    expect(manP.permissoes).not.toContain('exames.pedido.criar');
    expect(manP.permissoes).not.toContain('exames.resultado.revisar');
  });

  it('PDF: recusado fora da finalidade EXAME; em EXAME chega a DISPONIVEL sem miniatura e é servido como anexo', async () => {
    esperar(await api.chamar('POST', '/v1/arquivos', { token: gestor.token, idempotencia: true, body: { nome: 'x.pdf', tipo: 'application/pdf', tamanhoBytes: 1000, finalidade: 'CHECKIN' } }), 415, 'TIPO_ARQUIVO_NAO_PERMITIDO');
    const a = await enviar(api, gestor.token, gerarPdf(), 'application/pdf');
    expect(a).toMatchObject({ status: 'DISPONIVEL', finalidade: 'EXAME', tipo: 'application/pdf', urlMiniatura: null });
    const r = await fetch(a.urlVisualizacao);
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-type')).toMatch(/application\/pdf/);
    expect(r.headers.get('content-disposition') ?? '').toMatch(/^attachment/);
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('antivírus: PDF com a assinatura de teste EICAR fica REJEITADO e não é servido', async () => {
    const a = await enviar(api, gestor.token, gerarPdf('Laudo', EICAR), 'application/pdf');
    expect(a.status).toBe('REJEITADO');
    expect(a.motivoRejeicao).toBeTruthy();
    expect(a.urlVisualizacao).toBeNull();
  });

  it('equipe registra pedido; paciente é avisado, vê sem a observação interna; outro paciente recebe 404 (RN-EXA-001/002)', async () => {
    pedido = esperar(await api.chamar('POST', '/v1/exames/pedidos', { token: gestor.token, idempotencia: true, body: {
      pacienteId: pacienteA.pacienteId, itens: [{ nome: 'Hemograma completo' }, { nome: 'Glicemia de jejum', orientacoes: 'Jejum de 8 horas.' }],
      orientacoes: 'Envie os resultados pelo app.', observacao: 'Nota interna.',
    } }), 201).body;
    expect(pedido).toMatchObject({ status: 'ABERTO', observacao: 'Nota interna.', resultados: [], concluidoEm: null, solicitante: { usuarioId: gestor.usuarioId } });
    expect(pedido.itens).toEqual([{ nome: 'Hemograma completo', orientacoes: null }, { nome: 'Glicemia de jejum', orientacoes: 'Jejum de 8 horas.' }]);
    const doPaciente = esperar(await api.chamar('GET', `/v1/exames/pedidos/${pedido.id}`, { token: pacienteA.token }), 200).body;
    expect(doPaciente.observacao).toBeNull();
    expect(doPaciente.acoesPermitidas.includes('ENVIAR_RESULTADO')).toBe(pacienteEnvia);
    expect(doPaciente.acoesPermitidas).not.toContain('CANCELAR');
    esperar(await api.chamar('GET', `/v1/exames/pedidos/${pedido.id}`, { token: pacienteB.token }), 404);
    const ntf = esperar(await api.chamar('GET', '/v1/notificacoes', { token: pacienteA.token, query: { limite: 20 } }), 200).body.itens;
    expect(ntf.some((n: any) => n.tipo === 'EXAME_PEDIDO' && n.destino?.parametros?.pedidoId === pedido.id)).toBe(true);
    // Paciente não registra pedido.
    esperar(await api.chamar('POST', '/v1/exames/pedidos', { token: pacienteA.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, itens: [{ nome: 'X1' }] } }), 403);
    const pend = esperar(await api.chamar('GET', '/v1/inicio', { token: pacienteA.token }), 200).body.secoes.find((s: any) => s.tipo === 'EXAMES_PENDENTES');
    expect(pend?.dados.itens.map((p: any) => p.id)).toContain(pedido.id);
  });

  let resultado: any;
  it('resultado: arquivo de outra conta ou de outra finalidade é recusado; o válido entra AGUARDANDO_REVISAO (RN-EXA-003)', async () => {
    const quem = pacienteEnvia ? pacienteA : gestor;
    const deOutro = await enviar(api, quem === gestor ? pacienteA.token : gestor.token, gerarPng(), 'image/png', quem === gestor ? 'CHECKIN' : 'EXAME');
    esperar(await api.chamar('POST', '/v1/exames/resultados', { token: quem.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, titulo: 'Hemograma', arquivosIds: [deOutro.id] } }), 422, 'VALIDACAO_FALHOU');
    const deCheckin = await enviar(api, quem.token, gerarPng(), 'image/png', 'CHECKIN');
    esperar(await api.chamar('POST', '/v1/exames/resultados', { token: quem.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, titulo: 'Hemograma', arquivosIds: [deCheckin.id] } }), 422, 'VALIDACAO_FALHOU');
    const pdf = await enviar(api, quem.token, gerarPdf('Hemograma'), 'application/pdf');
    const foto = await enviar(api, quem.token, gerarPng(), 'image/png');
    resultado = esperar(await api.chamar('POST', '/v1/exames/resultados', { token: quem.token, idempotencia: true, body: {
      pacienteId: pacienteA.pacienteId, pedidoId: pedido.id, titulo: 'Hemograma completo', dataColeta: '2026-11-05', arquivosIds: [pdf.id, foto.id], comentario: 'Laboratório Central.',
    } }), 201).body;
    expect(resultado).toMatchObject({ status: 'AGUARDANDO_REVISAO', pedidoId: pedido.id, origem: quem === gestor ? 'EQUIPE' : 'PACIENTE', revisao: null, comentario: 'Laboratório Central.' });
    expect(resultado.arquivos.map((a: any) => a.tipo)).toEqual(['application/pdf', 'image/png']);
    // O mesmo arquivo não entra em dois resultados.
    esperar(await api.chamar('POST', '/v1/exames/resultados', { token: quem.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, titulo: 'De novo', arquivosIds: [pdf.id] } }), 422, 'VALIDACAO_FALHOU');
    const p = esperar(await api.chamar('GET', `/v1/exames/pedidos/${pedido.id}`, { token: gestor.token }), 200).body;
    expect(p.resultados.map((x: any) => x.id)).toEqual([resultado.id]);
  });

  it('paciente sem permissão de enviar não envia; com, não envia para outro paciente', async () => {
    if (!pacienteEnvia) {
      esperar(await api.chamar('POST', '/v1/arquivos', { token: pacienteA.token, idempotencia: true, body: { nome: 'l.png', tipo: 'image/png', tamanhoBytes: 100, finalidade: 'EXAME' } }), 403);
      return;
    }
    const foto = await enviar(api, pacienteA.token, gerarPng(), 'image/png');
    esperar(await api.chamar('POST', '/v1/exames/resultados', { token: pacienteA.token, idempotencia: true, body: { pacienteId: pacienteB.pacienteId, titulo: 'Exame', arquivosIds: [foto.id] } }), 404);
  });

  it('equipe vê o resultado para revisar (seção, contador, filtro); revisão é idempotente e avisa o paciente (RN-EXA-004)', async () => {
    const secao = esperar(await api.chamar('GET', '/v1/inicio', { token: gestor.token }), 200).body.secoes.find((s: any) => s.tipo === 'RESULTADOS_PARA_REVISAR');
    expect(secao.dados.total).toBeGreaterThanOrEqual(1);
    const cont = esperar(await api.chamar('GET', '/v1/contadores', { token: gestor.token }), 200).body;
    expect(cont['exames.resultadosParaRevisar']).toBe(secao.dados.total);
    const lista = esperar(await api.chamar('GET', '/v1/exames/resultados', { token: gestor.token, query: { status: 'AGUARDANDO_REVISAO', limite: 100 } }), 200).body.itens;
    expect(lista.map((x: any) => x.id)).toContain(resultado.id);
    expect(lista.find((x: any) => x.id === resultado.id).acoesPermitidas).toContain('REVISAR');
    esperar(await api.chamar('POST', `/v1/exames/resultados/${resultado.id}/revisar`, { token: pacienteA.token, body: {} }), 403);
    const r1 = esperar(await api.chamar('POST', `/v1/exames/resultados/${resultado.id}/revisar`, { token: gestor.token, body: { nota: 'Valores normais.' } }), 200).body;
    expect(r1).toMatchObject({ status: 'REVISADO', revisao: { por: { usuarioId: gestor.usuarioId }, nota: 'Valores normais.' }, acoesPermitidas: [] });
    const r2 = esperar(await api.chamar('POST', `/v1/exames/resultados/${resultado.id}/revisar`, { token: gestor.token, body: { nota: 'Outra nota.' } }), 200).body;
    expect(r2.revisao).toEqual(r1.revisao);
    const doPaciente = esperar(await api.chamar('GET', `/v1/exames/resultados/${resultado.id}`, { token: pacienteA.token }), 200).body;
    expect(doPaciente.revisao.nota).toBe('Valores normais.');
    esperar(await api.chamar('GET', `/v1/exames/resultados/${resultado.id}`, { token: pacienteB.token }), 404);
    const ntf = esperar(await api.chamar('GET', '/v1/notificacoes', { token: pacienteA.token, query: { limite: 20 } }), 200).body.itens;
    expect(ntf.some((n: any) => n.tipo === 'EXAME_REVISADO' && n.destino?.parametros?.resultadoId === resultado.id)).toBe(true);
    const depois = esperar(await api.chamar('GET', '/v1/contadores', { token: gestor.token }), 200).body;
    expect(depois['exames.resultadosParaRevisar']).toBe(cont['exames.resultadosParaRevisar'] - 1);
  });

  it('concluir e cancelar: só a equipe; finalizado não recebe resultado; repetir concluir não muda nada', async () => {
    esperar(await api.chamar('POST', `/v1/exames/pedidos/${pedido.id}/concluir`, { token: pacienteA.token }), 403);
    const c1 = esperar(await api.chamar('POST', `/v1/exames/pedidos/${pedido.id}/concluir`, { token: gestor.token }), 200).body;
    expect(c1.status).toBe('CONCLUIDO');
    expect(c1.concluidoEm).toBeTruthy();
    const c2 = esperar(await api.chamar('POST', `/v1/exames/pedidos/${pedido.id}/concluir`, { token: gestor.token }), 200).body;
    expect(c2.concluidoEm).toBe(c1.concluidoEm);
    esperar(await api.chamar('POST', `/v1/exames/pedidos/${pedido.id}/cancelar`, { token: gestor.token, body: { motivo: 'Tarde demais.' } }), 422, 'VALIDACAO_FALHOU');
    const foto = await enviar(api, gestor.token, gerarPng(), 'image/png');
    esperar(await api.chamar('POST', '/v1/exames/resultados', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, pedidoId: pedido.id, titulo: 'Atrasado', arquivosIds: [foto.id] } }), 422, 'VALIDACAO_FALHOU');
    const outro = esperar(await api.chamar('POST', '/v1/exames/pedidos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, itens: [{ nome: 'Ultrassom' }] } }), 201).body;
    const can = esperar(await api.chamar('POST', `/v1/exames/pedidos/${outro.id}/cancelar`, { token: gestor.token, body: { motivo: 'Pedido em duplicidade.' } }), 200).body;
    expect(can).toMatchObject({ status: 'CANCELADO', motivoCancelamento: 'Pedido em duplicidade.', acoesPermitidas: [] });
    const abertos = esperar(await api.chamar('GET', '/v1/exames/pedidos', { token: gestor.token, query: { pacienteId: pacienteA.pacienteId, status: 'ABERTO', limite: 100 } }), 200).body.itens;
    expect(abertos.map((p: any) => p.id)).not.toContain(outro.id);
  });

  it('configuração do módulo pelo gestor (PATCH /v1/organizacao) muda a permissão do paciente', async () => {
    const g = esperar(await api.chamar('GET', '/v1/organizacao', { token: gestor.token }), 200);
    const r = esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, headers: { 'If-Match': g.headers.get('etag')! }, body: { exames: { pacienteEnviaResultados: !pacienteEnvia } } }), 200);
    expect(r.body.exames.pacienteEnviaResultados).toBe(!pacienteEnvia);
    const r2 = esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, headers: { 'If-Match': r.headers.get('etag')! }, body: { exames: { pacienteEnviaResultados: pacienteEnvia } } }), 200);
    expect(r2.body.exames.pacienteEnviaResultados).toBe(pacienteEnvia);
  });
});
