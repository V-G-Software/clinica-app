// Captura respostas reais do mock para contrato/exemplos/respostas (documentação viva).
// Uso: com o mock no ar, `node contrato/scripts/capturar-exemplos.mjs`. Depois, `pnpm contrato:lint` valida.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encontrarOperacao } from '@clinica/contrato-validador';

const MOCK = process.env.MOCK_URL ?? 'http://localhost:4010';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../exemplos/respostas');
await fetch(`${MOCK}/__mock/reiniciar`, { method: 'POST' });
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const cont = {};
async function cap(base, metodo, caminho, { token, body, sufixo, idem } = {}) {
  const r = await fetch(base + caminho, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Cliente': 'NATIVO', ...(idem ? { 'Idempotency-Key': crypto.randomUUID() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type')?.split(';')[0];
  const texto = await r.text();
  const corpo = texto ? JSON.parse(texto) : undefined;
  const prefixo = new URL(base).pathname;
  const op = encontrarOperacao(metodo, new URL(base + caminho).pathname.slice(prefixo.length)).operacao.operationId;
  const nome = `${op}${sufixo ? `.${sufixo}` : ''}.json`;
  writeFileSync(path.join(dir, nome), JSON.stringify({ requisicao: `${metodo} ${caminho}`, status: r.status, contentType: ct, corpo }, null, 2) + '\n');
  cont[nome] = r.status;
  return corpo;
}
const D = `${MOCK}/diretorio`;
const O = `${MOCK}/o/modelo-otorrino`;
await cap(D, 'GET', '/v1/organizacoes/modelo-otorrino');
for (const slug of ['modelo-otorrino', 'fisio-movimento', 'vet-amigo']) await cap(`${MOCK}/o/${slug}`, 'GET', '/v1/publico/configuracao', { sufixo: slug });
await cap(O, 'GET', '/v1/publico/convites/convite-paulo-otorrino-0001');
await cap(O, 'GET', '/v1/sessao', { sufixo: 'erro-sem-token' });
const etapa = await cap(O, 'POST', '/v1/auth/entrar', { body: { email: 'ana@modelo-otorrino.exemplo', senha: 'Senha@12345' }, sufixo: 'mfa' });
const fim = await cap(O, 'POST', '/v1/auth/mfa/verificar', { body: { desafioId: etapa.desafioId, codigo: '000000' } });
const ana = fim.tokenAcesso;
await cap(O, 'POST', '/v1/auth/codigo/solicitar', { body: { email: 'marcos@exemplo.com' } });
const marcos = (await cap(O, 'POST', '/v1/auth/codigo/verificar', { body: { email: 'marcos@exemplo.com', codigo: '123456' } })).tokenAcesso;
await cap(O, 'GET', '/v1/sessao', { token: ana, sufixo: 'profissional' });
await cap(O, 'GET', '/v1/sessao', { token: marcos, sufixo: 'paciente' });
await cap(O, 'GET', '/v1/inicio', { token: ana, sufixo: 'equipe' });
const inicioPac = await cap(O, 'GET', '/v1/inicio', { token: marcos, sufixo: 'paciente' });
const acp = inicioPac.secoes.find((s) => s.tipo === 'ACOMPANHAMENTO_ATUAL').dados;
await cap(O, 'GET', `/v1/acompanhamentos/${acp.acompanhamentoId}`, { token: ana });
await cap(O, 'GET', `/v1/checkins/${acp.proximoCheckin.id}`, { token: marcos, sufixo: 'disponivel' });
await cap(O, 'GET', '/v1/alertas?status=ABERTO', { token: ana });
await cap(O, 'GET', '/v1/protocolos/prt_septo7', { token: ana });
await cap(O, 'GET', '/v1/formularios/frm_pos_op_diario', { token: ana });
await cap(O, 'GET', '/v1/pacientes?limite=3', { token: ana });
const conv = await cap(O, 'GET', '/v1/conversas?limite=3', { token: ana });
await cap(O, 'GET', `/v1/conversas/${conv.itens[0].id}/mensagens?limite=10`, { token: ana });
await cap(O, 'GET', '/v1/notificacoes?limite=5', { token: marcos });
await cap(O, 'GET', '/v1/equipe/membros', { token: ana });
await cap(O, 'POST', `/v1/checkins/${acp.proximoCheckin.id}/respostas`, { token: marcos, body: { respostas: { dor: 11 } }, sufixo: 'erro-validacao' });
// Agenda (1.1 — ADR-0016).
await cap(O, 'GET', '/v1/agenda/servicos', { token: ana });
await cap(O, 'GET', '/v1/agenda/grades/usr_ana', { token: ana });
await cap(O, 'GET', '/v1/agendamentos?de=2026-11-09&ate=2026-11-15', { token: ana, sufixo: 'semana' });
await cap(O, 'GET', '/v1/agendamentos/agd_beatriz_cirurgia', { token: ana, sufixo: 'cirurgia' });
await cap(O, 'GET', '/v1/agenda/horarios?servicoId=srv_consulta&de=2026-11-09&ate=2026-11-09', { token: marcos, sufixo: 'paciente' });
await cap(O, 'POST', '/v1/agendamentos', { token: ana, body: { pacienteId: 'pac_marcos', servicoId: 'srv_consulta', profissionalId: 'usr_ana', inicioEm: '2026-11-10T10:00:00Z' }, sufixo: 'erro-horario-indisponivel', idem: true });
const vet = `${MOCK}/o/vet-amigo`;
const laura = (await (await fetch(`${vet}/v1/auth/codigo/solicitar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'laura@exemplo.com' }) }), await (await fetch(`${vet}/v1/auth/codigo/verificar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'laura@exemplo.com', codigo: '123456' }) })).json())).tokenAcesso;
await cap(vet, 'GET', '/v1/sessao', { token: laura, sufixo: 'tutora-dois-pets' });
await cap(vet, 'GET', '/v1/inicio', { token: laura, sufixo: 'tutora-dois-pets' });
console.log(Object.entries(cont).map(([k, v]) => `${v} ${k}`).join('\n'));
