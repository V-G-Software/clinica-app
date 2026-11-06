// Seed da F2 a partir do cenário: protocolos, acompanhamentos (pela mesma regra da API), respostas
// programadas, alertas, conversas e mensagens. A linha do tempo do cenário é reproduzida até AGORA,
// em ordem cronológica; cada passo é "carimbado" com o instante do cenário (dentro da transação do
// seed, now() é constante: tudo que ainda tem now() acabou de ser criado pelo passo atual).
// O que fica no futuro vira job agendado normalmente (abrir, lembrar, expirar, concluir).
import type pg from 'pg';
import { DIA, diferencaDias, localParaUtc, partesLocais, somarDias } from '@clinica/dominio';
import { novoId } from '../src/cripto.ts';
import type { Tx } from '../src/db.ts';
import type { Log } from '../src/http.ts';
import type { Org } from '../src/nucleo.ts';
import { criarAcompanhamento, criarAlerta, encerrarAcompanhamento, resolverAlerta, responderCheckin } from '../src/servicos/acompanhamento.ts';
import { postarMensagem } from '../src/servicos/chat.ts';
import { storage } from '../src/servicos/storage.ts';

const silencioso: Log = { info: () => undefined, warn: () => undefined, error: (o, m) => console.error(m, o) };
// PNG 1×1 para as respostas "@foto" do cenário.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4cfQEAATlAlQ0yH6VAAAAAElFTkSuQmCC', 'base64');

const CARIMBOS: Array<[string, string]> = [
  ['mensagens', 'enviado_em'], ['alertas', 'criado_em'], ['alertas', 'resolvido_em'], ['checkins', 'respondido_em'],
  ['conversas', 'criado_em'], ['participantes', 'entrou_em'],
];
async function carimbar(tx: Tx, orgId: string, em: string) {
  for (const [t, col] of CARIMBOS) await tx.query(`UPDATE ${t} SET ${col} = $2 WHERE organizacao_id = $1 AND ${col} = now()`, [orgId, em]);
}

async function fotoDeExemplo(tx: Tx, org: Org, donoId: string, em: string) {
  const id = novoId('arq');
  await storage.gravar(`final/${org.id}/${id}`, PNG, 'image/png');
  await tx.query(`INSERT INTO arquivos (organizacao_id, id, dono_id, nome, tipo, tamanho_bytes, finalidade, status, chave_storage, criado_em)
                  VALUES ($1,$2,$3,'foto.png','image/png',$4,'CHECKIN','DISPONIVEL',$5,$6)`, [org.id, id, donoId, PNG.length, `final/${org.id}/${id}`, em]);
  return id;
}

/**
 * Os cenários têm datas absolutas pensadas para o relógio do mock (2026-11-08 13:30Z). Para o seed do
 * backend real mostrar o mesmo estado, a linha do tempo é deslocada em dias inteiros até hoje no fuso
 * da organização (CENARIO_DESLOCAR=0 desliga). Horários locais e dias da semana relativos se mantêm.
 */
export function deslocarCenario(cen: any, fuso: string, agora = Date.now()) {
  if (process.env.CENARIO_DESLOCAR === '0') return cen;
  const ref = Date.parse(process.env.CENARIO_RELOGIO ?? '2026-11-08T13:30:00Z');
  const dias = diferencaDias(partesLocais(ref, fuso).data, partesLocais(agora, fuso).data);
  if (!dias) return cen;
  const ms = (x?: string) => (x ? new Date(Date.parse(x) + dias * DIA).toISOString().replace(/\.000Z$/, 'Z') : x);
  const comEm = (xs?: any[]) => xs?.map((x) => ({ ...x, em: ms(x.em) }));
  return {
    ...cen,
    acompanhamentos: (cen.acompanhamentos ?? []).map((a: any) => ({
      ...a, dataInicio: somarDias(a.dataInicio, dias), criadoEm: ms(a.criadoEm), mensagens: comEm(a.mensagens), resolverAlertas: comEm(a.resolverAlertas),
      arquivarConversaEm: ms(a.arquivarConversaEm), encerrar: a.encerrar && { ...a.encerrar, em: ms(a.encerrar.em) },
    })),
    conversas: (cen.conversas ?? []).map((c: any) => ({ ...c, criadoEm: ms(c.criadoEm), mensagens: comEm(c.mensagens) })),
  };
}

export async function semearF2(c: pg.Client, org: Org, cenario: any, agora = Date.now()) {
  const tx = c as unknown as Tx;
  const cen = deslocarCenario(cenario, org.fuso, agora);
  for (const p of cen.protocolos ?? [])
    await tx.query(`INSERT INTO protocolos (organizacao_id, id, versao, nome, descricao, duracao_dias, status, checkins, orientacoes, regras_alerta)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [org.id, p.id, p.versao, p.nome, p.descricao ?? null, p.duracaoDias, p.status,
      JSON.stringify(p.checkins), JSON.stringify(p.orientacoes ?? []), JSON.stringify(p.regrasAlerta ?? [])]);

  type Passo = { em: number; fazer: () => Promise<void>; sempre?: boolean };
  const passos: Passo[] = [];
  for (const a of cen.acompanhamentos ?? []) {
    const criadoEm = Date.parse(a.criadoEm);
    passos.push({ em: criadoEm, sempre: true, fazer: async () => {
      await criarAcompanhamento(tx, org, { id: a.id, pacienteId: a.pacienteId, protocoloId: a.protocoloId, dataInicio: a.dataInicio, equipeIds: a.equipeIds, criadoPor: a.criadoPor, observacao: a.observacao ?? null, criadoEm: a.criadoEm }, silencioso, agora);
      // Check-ins vencidos antes de agora e sem resposta programada: aplica a regra CHECKIN_EXPIRADO.
      const prot = cen.protocolos.find((p: any) => p.id === a.protocoloId);
      for (const regra of (prot.regrasAlerta ?? []).filter((r: any) => r.tipo === 'CHECKIN_EXPIRADO')) {
        const vencidos = (await tx.query(`SELECT * FROM checkins WHERE organizacao_id = $1 AND acompanhamento_id = $2 AND status = 'EXPIRADO'`, [org.id, a.id])).rows
          .filter((ck) => !a.respostas?.[String(ck.dia)] && ck.expira_em.getTime() > criadoEm);
        for (const ck of vencidos) passos.push({ em: ck.expira_em.getTime(), fazer: async () => {
          const acp = (await tx.query('SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0];
          if (acp.status !== 'ENCERRADO') await criarAlerta(tx, org, acp, ck, regra, silencioso);
        } });
      }
    } });
    for (const [dia, r] of Object.entries<any>(a.respostas ?? {})) {
      const prog = cen.protocolos.find((p: any) => p.id === a.protocoloId).checkins.find((x: any) => x.dias.includes(Number(dia)));
      const em = localParaUtc(somarDias(a.dataInicio, Number(dia)), prog.horario, org.fuso) + (r.aposMinutos ?? 30) * 60_000;
      passos.push({ em, fazer: async () => {
        const ck = (await tx.query(`SELECT * FROM checkins WHERE organizacao_id = $1 AND acompanhamento_id = $2 AND dia = $3`, [org.id, a.id, Number(dia)])).rows[0];
        if (!ck || !['DISPONIVEL', 'EXPIRADO'].includes(ck.status)) return;
        const conta = (await tx.query(`SELECT usuario_id FROM vinculos WHERE organizacao_id = $1 AND paciente_id = $2 ORDER BY usuario_id LIMIT 1`, [org.id, a.pacienteId])).rows[0]?.usuario_id;
        if (!conta) return;
        const iso = new Date(em).toISOString();
        const respostas: Record<string, unknown> = {};
        for (const [k, v] of Object.entries<any>(r.respostas))
          respostas[k] = Array.isArray(v) ? await Promise.all(v.map((x) => (x === '@foto' ? fotoDeExemplo(tx, org, conta, iso) : x))) : v;
        // Retroativo: o check-in já tinha vencido quando o seed rodou, mas no cenário foi respondido a tempo.
        await tx.query(`UPDATE checkins SET status = 'DISPONIVEL' WHERE organizacao_id = $1 AND id = $2`, [org.id, ck.id]);
        await responderCheckin(tx, org, ck.id, respostas, conta, silencioso);
      } });
    }
    for (const m of a.mensagens ?? []) passos.push({ em: Date.parse(m.em), fazer: () => mensagem(a.id, null, m) });
    for (const x of a.resolverAlertas ?? []) passos.push({ em: Date.parse(x.em), fazer: async () => {
      for (const al of (await tx.query(`SELECT id FROM alertas WHERE organizacao_id = $1 AND acompanhamento_id = $2 AND status = 'ABERTO'`, [org.id, a.id])).rows)
        await resolverAlerta(tx, org, al.id, x.por, x.nota);
    } });
    if (a.arquivarConversaEm) passos.push({ em: Date.parse(a.arquivarConversaEm), fazer: async () => {
      await tx.query(`UPDATE conversas SET status = 'ARQUIVADA' WHERE organizacao_id = $1 AND id = (SELECT conversa_id FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2)`, [org.id, a.id]);
    } });
    if (a.encerrar) passos.push({ em: Date.parse(a.encerrar.em), fazer: async () => {
      const acp = (await tx.query('SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0];
      if (acp.status === 'ATIVO' || acp.status === 'AGENDADO') await encerrarAcompanhamento(tx, org, acp, a.encerrar.motivo, a.encerrar.por, silencioso);
    } });
  }
  for (const cv of cen.conversas ?? []) {
    passos.push({ em: Date.parse(cv.criadoEm) - 1, fazer: async () => {
      await tx.query(`INSERT INTO conversas (organizacao_id, id, paciente_id, status) VALUES ($1,$2,$3,'ATIVA')`, [org.id, cv.id, cv.pacienteId]);
      const usuarios = (await tx.query('SELECT id, perfis FROM usuarios WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, cv.participantesIds])).rows;
      for (const u of usuarios)
        await tx.query('INSERT INTO participantes (organizacao_id, conversa_id, usuario_id, perfil) VALUES ($1,$2,$3,$4)', [org.id, cv.id, u.id, u.perfis.includes('PROFISSIONAL') ? 'PROFISSIONAL' : u.perfis[0]]);
    } });
    for (const m of cv.mensagens ?? []) passos.push({ em: Date.parse(m.em), fazer: () => mensagem(null, cv.id, m) });
  }

  async function mensagem(acpId: string | null, conversaId: string | null, m: any) {
    const id = conversaId ?? (await tx.query('SELECT conversa_id FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, acpId])).rows[0]?.conversa_id;
    const conversa = id && (await tx.query('SELECT * FROM conversas WHERE organizacao_id = $1 AND id = $2', [org.id, id])).rows[0];
    if (conversa) await postarMensagem(tx, org, conversa, { tipo: 'TEXTO', autorId: m.autorId, texto: m.texto, idCliente: novoId('seed') }, silencioso);
  }

  // Executa em ordem cronológica até agora (passos podem agendar outros passos, ex.: alertas de vencidos).
  const feitos = new Set<Passo>();
  for (;;) {
    const proximo = passos.filter((p) => !feitos.has(p) && p.em <= agora).sort((x, y) => x.em - y.em)[0]
      // A criação do acompanhamento sempre roda (mesmo futura): o que vem depois vira job.
      ?? passos.filter((p) => !feitos.has(p) && p.sempre).sort((x, y) => x.em - y.em)[0];
    if (!proximo) break;
    feitos.add(proximo);
    await proximo.fazer();
    await carimbar(tx, org.id, new Date(Math.min(proximo.em, agora)).toISOString());
  }
  // O histórico do seed não é "novo" para quem entra: caixa de notificações e fila de eventos limpas.
  await tx.query('DELETE FROM notificacoes WHERE organizacao_id = $1', [org.id]);
  await tx.query('DELETE FROM eventos WHERE organizacao_id = $1', [org.id]);
  await tx.query(`DELETE FROM jobs WHERE organizacao_id = $1 AND tipo = 'push.enviar'`, [org.id]);
}
