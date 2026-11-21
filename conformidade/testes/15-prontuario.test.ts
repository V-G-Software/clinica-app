// Módulo `prontuario` (ADR-0019): ficha versionada, registros imutáveis depois de finalizados (adendo),
// modelos por especialidade, linha do tempo, log de acesso e cópia ao paciente sob pedido.
import { beforeAll, describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente, temModulo } from '../src/contexto.ts';

const amb = ambiente();
const { api, gestor, pacienteA, pacienteB } = amb;
const ativo = temModulo(amb, 'prontuario');
const P = `/v1/prontuario/pacientes/${pacienteA.pacienteId}`;
const FICHA = {
  alergias: [{ substancia: 'Penicilina', reacao: 'Urticária', gravidade: 'GRAVE' }],
  medicamentosEmUso: [{ nome: 'Losartana 50 mg', posologia: '1 comprimido ao dia' }],
  problemas: [{ descricao: 'Rinite alérgica', cid: 'J30.4', situacao: 'ATIVO', desde: '2026-01-10' }],
  antecedentes: { pessoais: 'Asma na infância.', familiares: null, habitos: 'Não fuma.' },
};

describe.runIf(!ativo)('prontuário — módulo não contratado', () => {
  it('rotas respondem 404 e o manifesto não mostra nada', async () => {
    esperar(await api.chamar('GET', `${P}/ficha`, { token: gestor.token }), 404, 'MODULO_NAO_CONTRATADO');
    esperar(await api.chamar('GET', '/v1/prontuario/copias', { token: pacienteA.token }), 404, 'MODULO_NAO_CONTRATADO');
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(man.permissoes.filter((p: string) => p.startsWith('prontuario.'))).toEqual([]);
  });
});

describe.runIf(ativo)('prontuário', () => {
  let modeloId: string;
  // O mesmo usuário no perfil PROFISSIONAL (quem lê e escreve); o token `gestor` está no perfil GESTOR (audita).
  const prof = { token: '', usuarioId: gestor.usuarioId };
  beforeAll(async () => {
    prof.token = esperar(await api.chamar('PUT', '/v1/sessao/perfil-ativo', { token: gestor.token, body: { perfil: 'PROFISSIONAL' } }), 200).body.tokenAcesso;
    const f = esperar(await api.chamar('POST', '/v1/formularios', { token: prof.token, body: { titulo: `Evolução conformidade ${Date.now()}`, finalidade: 'PRONTUARIO', campos: [
      { id: 'queixa', tipo: 'TEXTO_LONGO', rotulo: 'Queixa', obrigatorio: true }, { id: 'conduta', tipo: 'TEXTO_LONGO', rotulo: 'Conduta', obrigatorio: false },
    ] } }), 201).body;
    modeloId = f.id;
  });

  it('acesso (RN-PRO-001): profissional lê; paciente e outro perfil não; o paciente não tem permissão de leitura', async () => {
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: prof.token }), 200).body;
    expect(man.permissoes).toEqual(expect.arrayContaining(['prontuario.prontuario.ler', 'prontuario.registro.escrever', 'prontuario.copia.atender']));
    expect(man.permissoes).not.toContain('prontuario.acesso.auditar');
    const manG = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(manG.permissoes).toContain('prontuario.acesso.auditar');
    expect(manG.permissoes).not.toContain('prontuario.prontuario.ler');
    const manP = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    expect(manP.permissoes).toContain('prontuario.copia.solicitar');
    expect(manP.permissoes).not.toContain('prontuario.prontuario.ler');
    esperar(await api.chamar('GET', `${P}/ficha`, { token: pacienteA.token }), 404);
    esperar(await api.chamar('GET', `${P}/registros`, { token: pacienteA.token }), 404);
    esperar(await api.chamar('GET', '/v1/prontuario/pacientes/pac_inexistente/ficha', { token: prof.token }), 404);
  });

  it('ficha: versão 0 vazia; cada gravação cria versão nova com If-Match; versões anteriores ficam (RN-PRO-003)', async () => {
    const f0 = esperar(await api.chamar('GET', `${P}/ficha`, { token: prof.token }), 200);
    expect(f0.body).toMatchObject({ versao: 0, alergias: [], medicamentosEmUso: [], problemas: [], atualizadoPor: null, acoesPermitidas: ['EDITAR'] });
    esperar(await api.chamar('PUT', `${P}/ficha`, { token: prof.token, headers: { 'If-Match': '"velho"' }, body: FICHA }), 412, 'CONFLITO_VERSAO');
    const f1 = esperar(await api.chamar('PUT', `${P}/ficha`, { token: prof.token, headers: { 'If-Match': f0.headers.get('etag')! }, body: FICHA }), 200);
    expect(f1.body).toMatchObject({ versao: 1, alergias: FICHA.alergias, problemas: FICHA.problemas, atualizadoPor: { usuarioId: gestor.usuarioId } });
    const f2 = esperar(await api.chamar('PUT', `${P}/ficha`, { token: prof.token, headers: { 'If-Match': f1.headers.get('etag')! }, body: { ...FICHA, alergias: [] } }), 200);
    expect(f2.body.versao).toBe(2);
    const v = esperar(await api.chamar('GET', `${P}/ficha/versoes`, { token: prof.token }), 200).body.itens;
    expect(v.map((x: any) => x.versao)).toEqual([2, 1]);
    expect(v[1].alergias).toEqual(FICHA.alergias); // a versão 1 continua como era
    esperar(await api.chamar('PUT', `${P}/ficha`, { token: pacienteA.token, headers: { 'If-Match': f2.headers.get('etag')! }, body: FICHA }), 404);
  });

  let evolucao: any;
  it('registro: rascunho só do autor; modelo validado; finalizar torna imutável; descartar só rascunho (RN-PRO-002/003)', async () => {
    const criar = (body: any) => api.chamar('POST', `${P}/registros`, { token: prof.token, idempotencia: true, body });
    esperar(await criar({ tipo: 'EVOLUCAO' }), 422, 'VALIDACAO_FALHOU'); // nem texto nem respostas
    esperar(await criar({ tipo: 'EVOLUCAO', formularioId: modeloId, respostas: { conduta: 'x' } }), 422, 'VALIDACAO_FALHOU'); // falta obrigatório
    esperar(await criar({ tipo: 'ADENDO', texto: 'sem origem' }), 422, 'VALIDACAO_FALHOU');
    const r = esperar(await criar({ tipo: 'EVOLUCAO', formularioId: modeloId, respostas: { queixa: 'Obstrução nasal.' }, texto: 'Evolução inicial.' }), 201);
    evolucao = r.body;
    expect(evolucao).toMatchObject({ status: 'RASCUNHO', tipo: 'EVOLUCAO', autor: { usuarioId: gestor.usuarioId }, modelo: { formularioId: modeloId, versao: 1 }, finalizadoEm: null, adendosIds: [] });
    expect(evolucao.acoesPermitidas).toEqual(expect.arrayContaining(['EDITAR', 'FINALIZAR', 'DESCARTAR']));
    const e = esperar(await api.chamar('PATCH', `/v1/prontuario/registros/${evolucao.id}`, { token: prof.token, headers: { 'If-Match': r.headers.get('etag')! }, body: { texto: 'Evolução revisada.' } }), 200);
    expect(e.body.texto).toBe('Evolução revisada.');
    const fin = esperar(await api.chamar('POST', `/v1/prontuario/registros/${evolucao.id}/finalizar`, { token: prof.token }), 200).body;
    expect(fin).toMatchObject({ status: 'FINALIZADO', acoesPermitidas: ['ADENDAR'] });
    expect(fin.finalizadoEm).toBeTruthy();
    const fin2 = esperar(await api.chamar('POST', `/v1/prontuario/registros/${evolucao.id}/finalizar`, { token: prof.token }), 200).body;
    expect(fin2.finalizadoEm).toBe(fin.finalizadoEm);
    // Imutável: nem edição nem descarte.
    esperar(await api.chamar('PATCH', `/v1/prontuario/registros/${evolucao.id}`, { token: prof.token, headers: { 'If-Match': e.headers.get('etag')! }, body: { texto: 'mudança' } }), [412, 422]);
    esperar(await api.chamar('POST', `/v1/prontuario/registros/${evolucao.id}/descartar`, { token: prof.token }), 422);
    evolucao = fin;
    // Rascunho descartado some da lista.
    const rasc = esperar(await criar({ tipo: 'ANAMNESE', texto: 'Rascunho a descartar.' }), 201).body;
    esperar(await api.chamar('POST', `/v1/prontuario/registros/${rasc.id}/descartar`, { token: prof.token }), 200);
    const lista = esperar(await api.chamar('GET', `${P}/registros`, { token: prof.token, query: { limite: 100 } }), 200).body.itens;
    expect(lista.map((x: any) => x.id)).toContain(evolucao.id);
    expect(lista.map((x: any) => x.id)).not.toContain(rasc.id);
    esperar(await api.chamar('GET', `/v1/prontuario/registros/${evolucao.id}`, { token: pacienteA.token }), 404);
  });

  it('adendo: corrige o finalizado sem mudá-lo e aparece ligado a ele', async () => {
    const a = esperar(await api.chamar('POST', `${P}/registros`, { token: prof.token, idempotencia: true, body: { tipo: 'ADENDO', registroOrigemId: evolucao.id, texto: 'Correção: retorno em 7 dias.', finalizar: true } }), 201).body;
    expect(a).toMatchObject({ tipo: 'ADENDO', status: 'FINALIZADO', registroOrigemId: evolucao.id });
    const o = esperar(await api.chamar('GET', `/v1/prontuario/registros/${evolucao.id}`, { token: prof.token }), 200).body;
    expect(o.adendosIds).toEqual([a.id]);
    expect(o.texto).toBe('Evolução revisada.'); // o original não muda
    // Adendo de outro paciente: recusado.
    esperar(await api.chamar('POST', `/v1/prontuario/pacientes/${pacienteB.pacienteId}/registros`, { token: prof.token, idempotencia: true, body: { tipo: 'ADENDO', registroOrigemId: evolucao.id, texto: 'x' } }), 422);
  });

  it('linha do tempo: registros finalizados e eventos dos outros módulos, com destino de tela', async () => {
    const l = esperar(await api.chamar('GET', `${P}/linha-do-tempo`, { token: prof.token, query: { limite: 100 } }), 200).body.itens;
    const reg = l.find((i: any) => i.tipo === 'REGISTRO' && i.id === evolucao.id);
    expect(reg).toMatchObject({ destino: { tela: 'prontuario.registro', parametros: { registroId: evolucao.id } } });
    const datas = l.map((i: any) => i.ocorridoEm);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it('log de acesso: cada leitura registrada; só a gestão (perfil GESTOR) consulta, e o gestor não lê o prontuário', async () => {
    esperar(await api.chamar('GET', `${P}/acessos`, { token: prof.token }), 403);
    esperar(await api.chamar('GET', `${P}/ficha`, { token: gestor.token }), 404); // perfil GESTOR não lê
    const acessos = esperar(await api.chamar('GET', `${P}/acessos`, { token: gestor.token, query: { limite: 100 } }), 200).body.itens;
    const acoes = new Set(acessos.map((x: any) => x.acao));
    for (const x of ['LER_FICHA', 'LER_REGISTROS', 'LER_REGISTRO', 'LER_LINHA_DO_TEMPO', 'LER_VERSOES']) expect(acoes.has(x)).toBe(true);
    expect(acessos.every((x: any) => x.usuario.usuarioId === gestor.usuarioId)).toBe(true);
    const datas = acessos.map((x: any) => x.acessadoEm);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it('cópia (RN-PRO-005): paciente pede (repetir devolve o mesmo); equipe atende com PDF; prazo de 15 dias; outro paciente não vê', async () => {
    const r1 = esperar(await api.chamar('POST', '/v1/prontuario/copias', { token: pacienteA.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), 201).body;
    expect(r1).toMatchObject({ status: 'SOLICITADA', arquivo: null, acoesPermitidas: [] });
    expect(Date.parse(r1.prazoEm) - Date.parse(r1.criadoEm)).toBe(15 * 86_400_000);
    const r2 = esperar(await api.chamar('POST', '/v1/prontuario/copias', { token: pacienteA.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), 200).body;
    expect(r2.id).toBe(r1.id);
    esperar(await api.chamar('POST', '/v1/prontuario/copias', { token: pacienteA.token, idempotencia: true, body: { pacienteId: pacienteB.pacienteId } }), 404);
    esperar(await api.chamar('POST', '/v1/prontuario/copias', { token: prof.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), 403);
    const pend = esperar(await api.chamar('GET', '/v1/prontuario/copias', { token: prof.token, query: { status: 'SOLICITADA', limite: 100 } }), 200).body.itens;
    expect(pend.find((c: any) => c.id === r1.id)?.acoesPermitidas).toEqual(['ATENDER', 'RECUSAR']);
    const cont = esperar(await api.chamar('GET', '/v1/contadores', { token: prof.token }), 200).body;
    expect(cont['prontuario.copiasPendentes']).toBeGreaterThanOrEqual(1);
    esperar(await api.chamar('POST', `/v1/prontuario/copias/${r1.id}/atender`, { token: pacienteA.token }), 403);
    const at = esperar(await api.chamar('POST', `/v1/prontuario/copias/${r1.id}/atender`, { token: prof.token }), 200).body;
    expect(at).toMatchObject({ status: 'DISPONIVEL', atendidoPor: { usuarioId: gestor.usuarioId }, arquivo: { tipo: 'application/pdf', finalidade: 'PRONTUARIO', status: 'DISPONIVEL' } });
    esperar(await api.chamar('POST', `/v1/prontuario/copias/${r1.id}/recusar`, { token: prof.token, body: { motivo: 'Tarde demais.' } }), 422);
    const minhas = esperar(await api.chamar('GET', '/v1/prontuario/copias', { token: pacienteA.token }), 200).body.itens;
    const minha = minhas.find((c: any) => c.id === r1.id);
    const pdf = await fetch(minha.arquivo.urlVisualizacao);
    expect(pdf.ok).toBe(true);
    expect(pdf.headers.get('content-disposition') ?? '').toMatch(/^attachment/);
    const outras = esperar(await api.chamar('GET', '/v1/prontuario/copias', { token: pacienteB.token }), 200).body.itens;
    expect(outras.map((c: any) => c.id)).not.toContain(r1.id);
    const ntf = esperar(await api.chamar('GET', '/v1/notificacoes', { token: pacienteA.token, query: { limite: 20 } }), 200).body.itens;
    expect(ntf.some((n: any) => n.tipo === 'COPIA_PRONTUARIO_DISPONIVEL')).toBe(true);
    // Recusa com motivo num pedido novo.
    const r3 = esperar(await api.chamar('POST', '/v1/prontuario/copias', { token: pacienteA.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), 201).body;
    const rec = esperar(await api.chamar('POST', `/v1/prontuario/copias/${r3.id}/recusar`, { token: prof.token, body: { motivo: 'Pedido em duplicidade; cópia entregue ontem.' } }), 200).body;
    expect(rec).toMatchObject({ status: 'RECUSADA', motivoRecusa: 'Pedido em duplicidade; cópia entregue ontem.', arquivo: null });
  });

  it('arquivo de prontuário só o servidor cria', async () => {
    esperar(await api.chamar('POST', '/v1/arquivos', { token: prof.token, idempotencia: true, body: { nome: 'p.pdf', tipo: 'application/pdf', tamanhoBytes: 100, finalidade: 'PRONTUARIO' } }), 422);
  });
});
