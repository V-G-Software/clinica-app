// E2E do critério de saída da F2: o MESMO frontend, apontado para o backend real só pelo endereço do
// diretório (VITE_DIRETORIO_URL), faz o fluxo principal — login da equipe (senha + MFA) e do paciente
// (código), check-in respondido, alerta chegando à equipe em tempo real, chat nos dois sentidos, agenda e
// exames (pedido → foto + PDF pelo antivírus e saneamento reais → revisão com nota, em tempo real).
// Sem /__mock: o estado é preparado pela própria API (acompanhamento retroativo com check-in aberto).
// Pré-requisitos: backend com MODO_TESTE_CODIGO_EMAIL=123456 e MODO_TESTE_TOTP=000000, semeado;
// frontend com VITE_DIRETORIO_URL=http://localhost:4020/diretorio. Uso: node e2e/backend-real.mjs [capturas]
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EICAR, gerarPdf } from './pdf.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = process.env.E2E_APP ?? 'http://localhost:5173';
const API = (process.env.E2E_API ?? 'http://localhost:4020') + '/o/modelo-otorrino';
const CAPTURAS = process.argv[2];
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };
const foto = async (page, nome) => { if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nome}.png` }); };
const ola = (page) => page.getByRole('heading', { name: /^Olá/ }).waitFor();

async function api(metodo, rota, { token, body, headers = {} } = {}) {
  const r = await fetch(`${API}${rota}`, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-Cliente': 'NATIVO', 'Idempotency-Key': randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body && JSON.stringify(body) });
  const corpo = r.status === 204 ? null : await r.json();
  if (r.status >= 400) throw new Error(`${metodo} ${rota} → ${r.status} ${JSON.stringify(corpo)}`);
  return corpo;
}

// ─── Preparação pela API: protocolo com o horário de 1 h atrás e acompanhamento começando ontem ───
let r = await api('POST', '/v1/auth/entrar', { body: { email: 'ana@modelo-otorrino.exemplo', senha: 'Senha@12345' } });
r = await api('POST', '/v1/auth/mfa/verificar', { body: { desafioId: r.desafioId, codigo: '000000' } });
const tokenAna = r.tokenAcesso;
const fuso = (await api('GET', '/v1/sessao', { token: tokenAna })).organizacao.fuso;
const local = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const h = local(Date.now() - 60 * 60_000);
const ontem = local(Date.now() - 24 * 60 * 60_000 - 60 * 60_000);
const base = await api('GET', '/v1/protocolos/prt_septo7', { token: tokenAna });
const prot = await api('POST', '/v1/protocolos', { token: tokenAna, body: {
  nome: `E2E backend real ${Date.now()}`, duracaoDias: 2,
  checkins: [{ ...base.checkins[0], dias: [1, 2], horario: `${h.hour}:${h.minute}`, expiraAposHoras: 12, lembreteAposHoras: null }],
  regrasAlerta: base.regrasAlerta,
} });
const acp = await api('POST', '/v1/acompanhamentos', { token: tokenAna, body: { pacienteId: 'pac_marcos', protocoloId: prot.id, dataInicio: `${ontem.year}-${ontem.month}-${ontem.day}`, equipeIds: ['usr_ana'] } });
const checkin = (await api('GET', `/v1/checkins?acompanhamentoId=${acp.id}`, { token: tokenAna })).itens.find((c) => c.status === 'DISPONIVEL');
ok(!!checkin, 'preparação: check-in DISPONIVEL criado pela API do backend real');

const browser = await chromium.launch();
const contexto = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' });

// ─── Equipe (Ana) pelo navegador: senha + MFA ───
const ctxAna = await contexto();
const ana = await ctxAna.newPage();
await ana.goto(`${APP}/?org=modelo-otorrino`);
await ana.getByRole('button', { name: 'Sou da equipe' }).click();
await ana.getByLabel('E-mail').fill('ana@modelo-otorrino.exemplo');
await ana.getByLabel('Senha').fill('Senha@12345');
await ana.getByRole('button', { name: 'Entrar' }).click();
await ana.getByLabel('Código de 6 dígitos').fill('000000');
await ana.getByRole('button', { name: 'Continuar' }).click();
await ola(ana);
ok(true, 'equipe: login com senha e MFA no backend real');
await foto(ana, 'real-1-equipe-inicio');

// ─── Paciente (Marcos): código por e-mail, responde o check-in ───
const ctxMarcos = await contexto();
const marcos = await ctxMarcos.newPage();
await marcos.goto(`${APP}/?org=modelo-otorrino`);
await marcos.getByRole('button', { name: /Sou paciente/ }).click();
await marcos.getByLabel('E-mail').fill('marcos@exemplo.com');
await marcos.getByRole('button', { name: 'Enviar código' }).click();
await marcos.getByLabel('Código de 6 dígitos').fill('123456');
await marcos.getByRole('button', { name: 'Continuar' }).click();
await ola(marcos);
ok(true, 'paciente: login por código no backend real');
await marcos.goto(`${APP}/checkins/${checkin.id}`);
await marcos.getByRole('heading', { name: /Check-in do dia 1/ }).waitFor();
await marcos.getByRole('radio', { name: '6' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
await marcos.getByRole('radio', { name: 'Regular' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
await marcos.getByRole('radio', { name: 'Intenso' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
await marcos.getByRole('radio', { name: 'Não' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
await marcos.getByRole('button', { name: 'Próxima' }).click(); // foto (opcional)
await marcos.getByRole('button', { name: 'Revisar' }).click(); // observação (opcional)
await marcos.getByRole('heading', { name: 'Confira suas respostas' }).waitFor();
await marcos.getByRole('button', { name: 'Enviar para a equipe' }).click();
await marcos.getByRole('heading', { name: 'Recebido!' }).waitFor();
ok(true, 'check-in: respondido e confirmado pelo backend real');
ok(!(await marcos.getByText(/Sangramento intenso relatado/).count()), 'check-in: paciente não vê o alerta');
await foto(marcos, 'real-2-checkin-recebido');

// O alerta da regra chega à equipe sem recarregar (SSE do backend real).
await ana.getByText('Sangramento intenso relatado').first().waitFor({ timeout: 8000 })
  .then(() => ok(true, 'tempo real: alerta chegou à equipe sem recarregar'), () => ok(false, 'tempo real: alerta chegou à equipe sem recarregar'));
await foto(ana, 'real-3-equipe-alerta');

// ─── Chat nos dois sentidos ───
await marcos.goto(`${APP}/conversas`);
await marcos.getByRole('link', { name: /Clínica Modelo Otorrino/ }).first().click();
await marcos.waitForURL(/\/conversas\/.+/);
await marcos.getByRole('textbox', { name: 'Mensagem' }).waitFor();
const conversaUrl = marcos.url().replace(APP, '');
await ana.goto(`${APP}${conversaUrl}`);
await ana.getByRole('textbox', { name: 'Mensagem' }).waitFor();
const t1 = `Doutora, o sangramento diminuiu (${Date.now()}).`;
await marcos.getByRole('textbox', { name: 'Mensagem' }).fill(t1);
await marcos.getByRole('button', { name: 'Enviar', exact: true }).click();
await ana.getByText(t1).waitFor({ timeout: 6000 }).then(() => ok(true, 'chat: mensagem do paciente chega à equipe em tempo real'), () => ok(false, 'chat: mensagem do paciente chega à equipe em tempo real'));
const t2 = `Ótimo, Marcos. Continue com o soro (${Date.now()}).`;
await ana.getByRole('textbox', { name: 'Mensagem' }).fill(t2);
await ana.getByRole('button', { name: 'Enviar', exact: true }).click();
await marcos.getByText(t2).waitFor({ timeout: 6000 }).then(() => ok(true, 'chat: resposta da equipe chega ao paciente em tempo real'), () => ok(false, 'chat: resposta da equipe chega ao paciente em tempo real'));
ok(await marcos.getByText(/Dia 1 ·/).count() > 0, 'chat: check-in respondido aparece na conversa (RN-ACO-007)');
await foto(marcos, 'real-4-chat-paciente');

// ─── Agenda (F4): equipe marca no horário livre; paciente confirma; equipe vê sem recarregar ───
await ana.goto(`${APP}/agenda/novo?pacienteId=pac_marcos`);
await ana.getByText('Marcos Souza').waitFor();
await ana.getByLabel('Serviço').selectOption({ label: 'Consulta otorrinolaringológica (30 min)' });
await ana.getByRole('button', { name: 'Próxima semana' }).click();
await ana.getByRole('button', { name: /^\d{2}:\d{2}/ }).first().click();
await ana.getByRole('button', { name: 'Marcar', exact: true }).click();
await ana.waitForURL(/\/agenda\/agd_/);
const agendamentoId = ana.url().split('/').pop();
await ana.getByText('Agendado', { exact: true }).waitFor({ timeout: 8000 })
  .then(() => ok(true, 'agenda: equipe marca no horário livre (backend real)'), () => ok(false, 'agenda: equipe marca no horário livre (backend real)'));
await marcos.goto(`${APP}/agenda/${agendamentoId}`);
await marcos.getByRole('button', { name: 'Confirmar presença' }).click();
await marcos.getByText('Confirmado', { exact: true }).first().waitFor({ timeout: 8000 })
  .then(() => ok(true, 'agenda: paciente confirma presença'), () => ok(false, 'agenda: paciente confirma presença'));
await ana.getByText('Confirmado', { exact: true }).first().waitFor({ timeout: 8000 })
  .then(() => ok(true, 'agenda: confirmação chega à equipe em tempo real'), () => ok(false, 'agenda: confirmação chega à equipe em tempo real'));
await foto(ana, 'real-5-agenda-confirmada');
await api('POST', `/v1/agendamentos/${agendamentoId}/cancelar`, { token: tokenAna, body: { motivo: 'E2E concluído.' } });

// ─── Exames (F5): pedido → paciente envia foto + PDF (antivírus e saneamento reais) → revisão com nota ───
const passo = (p, m, ms = 10000) => p.waitFor({ timeout: ms }).then(() => ok(true, m), () => ok(false, m));
await ana.goto(`${APP}/exames/novo?pacienteId=pac_marcos`);
await ana.getByText('Marcos Souza').waitFor();
await ana.getByLabel('Exame 1', { exact: true }).fill('Audiometria tonal');
await ana.getByLabel('Preparo (opcional)').fill('Evite ruído alto 24 h antes.');
await ana.getByRole('button', { name: 'Registrar pedido' }).click();
await ana.waitForURL(/\/exames\/pedidos\//);
await passo(ana.getByText('Aberto', { exact: true }), 'exames: pedido registrado (backend real)');
await marcos.goto(`${APP}/exames/meus`);
await passo(marcos.getByText(/Evite ruído alto/), 'exames: paciente vê o pedido com preparo');
await marcos.locator('main a[href^="/exames/enviar?pedidoId="]').first().click();
await marcos.waitForURL(/\/exames\/enviar\?pedidoId=/);
const entrada = marcos.getByLabel('Arquivos do resultado');
await entrada.setInputFiles({ name: 'virus.pdf', mimeType: 'application/pdf', buffer: gerarPdf(EICAR) });
await passo(marcos.getByRole('alert').filter({ hasText: /./ }), 'exames: antivírus recusa PDF infectado (EICAR)', 20000);
await entrada.setInputFiles(fileURLToPath(new URL('./foto-teste.png', import.meta.url)));
await passo(marcos.getByRole('button', { name: /^Remover foto-teste/ }), 'exames: foto enviada ao storage', 20000);
await entrada.setInputFiles({ name: 'audiometria.pdf', mimeType: 'application/pdf', buffer: gerarPdf() });
await passo(marcos.getByRole('button', { name: 'Remover audiometria.pdf' }), 'exames: PDF verificado e saneado', 30000);
await ana.goto(`${APP}/exames`);
await ana.getByRole('button', { name: /Para revisar/ }).waitFor();
await marcos.getByRole('button', { name: 'Enviar', exact: true }).click();
await marcos.waitForURL(/\/exames\/resultados\//);
await passo(marcos.getByRole('link', { name: /audiometria\.pdf/ }), 'exames: resultado com o PDF para baixar');
const urlPdf = await marcos.getByRole('link', { name: /audiometria\.pdf/ }).getAttribute('href');
const resp = await fetch(urlPdf);
ok(resp.ok && /attachment/.test(resp.headers.get('content-disposition') ?? '') && (await resp.arrayBuffer()).byteLength > 0, 'exames: PDF servido como anexo pela URL assinada');
await passo(ana.getByText('Audiometria tonal').first(), 'exames: resultado chega à fila da equipe em tempo real');
await ana.getByText('Audiometria tonal').first().click();
await ana.getByLabel(/Nota para o paciente/).fill('Audição dentro do normal.');
await ana.getByRole('button', { name: 'Marcar como revisado' }).click();
await passo(ana.getByText(/Revisado por/), 'exames: equipe revisa com nota');
await passo(marcos.getByText('Audição dentro do normal.'), 'exames: paciente vê a nota sem recarregar');
await foto(marcos, 'real-6-exame-revisado');

// Limpeza: encerra o acompanhamento de teste.
await api('POST', `/v1/acompanhamentos/${acp.id}/encerrar`, { token: tokenAna, body: { motivo: 'E2E concluído.' } });
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nE2E contra o backend real: tudo certo');
process.exit(falhas ? 1 : 0);
