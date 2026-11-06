// Decisões de produto que a suíte de conformidade não alcança (QUESTION-014 e 019):
// - termos com versão nova: `org:atualizar` avisa as contas ativas (o aceite continua no próximo login);
// - conclusão AUTOMÁTICA (job) com `resolverAlertasAoEncerrar`: alertas resolvidos sem autor.
// Usa a organização fisio-movimento, que nenhum outro teste do backend usa (os arquivos rodam em paralelo).
import { readFileSync } from 'node:fs';
import { partesLocais } from '@clinica/dominio';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atualizarOrganizacao } from '../scripts/org.ts';
import { config } from '../src/config.ts';
import { novoId } from '../src/cripto.ts';
import { comOrg, pool } from '../src/db.ts';
import type { Log } from '../src/http.ts';
import { esquecerOrg, orgPorSlug, type Org } from '../src/nucleo.ts';
import { criarAcompanhamento, criarAlerta, encerrarAcompanhamento } from '../src/servicos/acompanhamento.ts';
import { executarVencidos } from '../src/servicos/jobs.ts';

const log: Log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const SLUG = 'fisio-movimento';
const GESTOR = 'usr_pedro';
const cenarioFisio = () => JSON.parse(readFileSync(new URL('../../contrato/exemplos/cenarios/fisio-movimento.json', import.meta.url), 'utf8'));
let org: Org;
let dono: pg.Client;
const ler = <T = any>(sql: string, params: unknown[]) => comOrg(org.id, async (tx) => (await tx.query(sql, params)).rows as T[]);

beforeAll(async () => {
  org = (await orgPorSlug(SLUG))!;
  dono = new pg.Client({ connectionString: config.bancoDono });
  await dono.connect();
});
afterAll(async () => { await dono.end(); await pool.end(); });

describe('termos novos avisam as contas ativas (QUESTION-014)', () => {
  it('versão nova: notificação SISTEMA para cada conta ativa que ainda não aceitou; mesma versão: ninguém é avisado', async () => {
    const cen = cenarioFisio();
    const original = cen.organizacao.autenticacao.termosVersao;
    const nova = `${original}-teste-${Date.now()}`;
    const antes = new Date();
    const ativos = await ler<{ id: string }>(`SELECT id FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO'`, [org.id]);
    try {
      cen.organizacao.autenticacao.termosVersao = nova;
      const r = await atualizarOrganizacao(dono, cen, { aviso: 'Mudamos a política de privacidade.', log: () => undefined });
      expect(r.avisados).toBe(ativos.length);
      const ntf = await ler(`SELECT usuario_id, tipo, titulo, texto, destino FROM notificacoes WHERE organizacao_id = $1 AND criado_em >= $2 AND titulo = 'Termos de uso atualizados'`, [org.id, antes]);
      expect(new Set(ntf.map((n) => n.usuario_id))).toEqual(new Set(ativos.map((u) => u.id)));
      expect(ntf.every((n) => n.tipo === 'SISTEMA' && n.texto === 'Mudamos a política de privacidade.' && n.destino.tela === 'perfil')).toBe(true);
      // Ninguém aceitou ainda: o aceite fica para o próximo login (etapa ACEITAR_TERMOS), não é forçado agora.
      const aceitos = await ler(`SELECT 1 FROM usuarios WHERE organizacao_id = $1 AND termos_aceitos_versao = $2`, [org.id, nova]);
      expect(aceitos).toHaveLength(0);
      const aud = await ler(`SELECT 1 FROM auditoria WHERE organizacao_id = $1 AND acao = 'ATUALIZAR_TERMOS' AND em >= $2`, [org.id, antes]);
      expect(aud).toHaveLength(1);
      // Reaplicar o mesmo arquivo (só marca, textos...) não avisa de novo.
      expect((await atualizarOrganizacao(dono, cen, { log: () => undefined })).avisados).toBe(0);
    } finally {
      cen.organizacao.autenticacao.termosVersao = original;
      await atualizarOrganizacao(dono, cen, { log: () => undefined });
      esquecerOrg(SLUG);
    }
  });
});

describe('alertas abertos no fim do acompanhamento (QUESTION-019)', () => {
  async function comOpcao<T>(valor: boolean, fn: () => Promise<T>) {
    const modulos = (o: any[], v: boolean) => o.map((m) => (m.id === 'acompanhamento' ? { ...m, config: { ...m.config, resolverAlertasAoEncerrar: v } } : m));
    await pool.query('UPDATE organizacoes SET modulos = $2 WHERE id = $1', [org.id, JSON.stringify(modulos(org.modulos, valor))]);
    esquecerOrg(SLUG);
    org = (await orgPorSlug(SLUG))!;
    try { return await fn(); } finally {
      await pool.query('UPDATE organizacoes SET modulos = $2 WHERE id = $1', [org.id, JSON.stringify(modulos(org.modulos, false))]);
      esquecerOrg(SLUG);
      org = (await orgPorSlug(SLUG))!;
    }
  }
  /** Acompanhamento de hoje, com um alerta aberto. */
  const cenario = () => comOrg(org.id, async (tx) => {
    const sufixo = novoId('t').slice(-10);
    const pac = `pac_teste_${sufixo}`;
    await tx.query(`INSERT INTO pacientes (organizacao_id, id, tipo, nome, nome_busca, contato) VALUES ($1,$2,'PESSOA',$3,$4,'{}')`, [org.id, pac, `Teste ${sufixo}`, `teste ${sufixo}`]);
    const protocoloId = novoId('prt');
    await tx.query(`INSERT INTO protocolos (organizacao_id, id, versao, nome, duracao_dias, status, checkins, regras_alerta) VALUES ($1,$2,1,'Teste',2,'ATIVO',$3,'[]')`, [org.id, protocoloId,
      JSON.stringify([{ dias: [1], horario: '09:00', formulario: { id: 'frm_registro_exercicios', versao: 1 }, lembreteAposHoras: null, expiraAposHoras: 12 }])]);
    const a = await criarAcompanhamento(tx, org, { pacienteId: pac, protocoloId, dataInicio: partesLocais(Date.now(), org.fuso).data, equipeIds: [GESTOR], criadoPor: GESTOR, observacao: null }, log);
    const alerta = await criarAlerta(tx, org, a, null, { id: `manual_${sufixo}`, severidade: 'MEDIA', mensagem: 'Alerta de teste' }, log);
    return { a, alertaId: alerta!.id as string };
  });
  const alerta = async (id: string) => (await ler('SELECT status, resolvido_por, nota FROM alertas WHERE organizacao_id = $1 AND id = $2', [org.id, id]))[0];

  it('conclusão automática (job) resolve sem autor, com nota própria', () => comOpcao(true, async () => {
    const { a, alertaId } = await cenario();
    await comOrg(org.id, (tx) => tx.query(`UPDATE jobs SET executar_em = now() - interval '1 second' WHERE organizacao_id = $1 AND id = $2`, [org.id, `acompanhamento:${a.id}:concluir`]));
    while (await executarVencidos(log) > 0);
    expect((await ler('SELECT status FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id]))[0].status).toBe('CONCLUIDO');
    expect(await alerta(alertaId)).toEqual({ status: 'RESOLVIDO', resolvido_por: null, nota: 'Acompanhamento concluído.' });
  }));

  it('encerramento manual resolve em nome de quem encerrou', () => comOpcao(true, async () => {
    const { a, alertaId } = await cenario();
    await comOrg(org.id, (tx) => encerrarAcompanhamento(tx, org, a, 'Teste.', GESTOR, log));
    expect(await alerta(alertaId)).toEqual({ status: 'RESOLVIDO', resolvido_por: GESTOR, nota: 'Acompanhamento encerrado.' });
  }));

  it('sem a opção (padrão), o alerta continua aberto', async () => {
    const { a, alertaId } = await cenario();
    await comOrg(org.id, (tx) => encerrarAcompanhamento(tx, org, a, 'Teste.', GESTOR, log));
    expect((await alerta(alertaId)).status).toBe('ABERTO');
  });
});
