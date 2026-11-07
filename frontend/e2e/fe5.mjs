// E2E de exames (F5, ADR-0017) contra o mock. Relógio do mock: domingo, 2026-11-08 10:30 em São Paulo.
// Médica: fila "para revisar" com contador, revisão com nota, pedido estruturado. Paciente: pedido no início,
// nota da revisão, envio de foto + PDF (e PDF com vírus recusado), tempo real até a equipe.
// Secretária: vê e anexa, não pede nem revisa. Vet: tutora sem envio. Fisio: sem o módulo.
// Uso: node e2e/fe5.mjs [capturas]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EICAR, gerarPdf as pdf } from './pdf.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = process.env.E2E_APP ?? 'http://localhost:5173';
const MOCK = process.env.E2E_MOCK ?? 'http://localhost:4010';
const CAPTURAS = process.argv[2];
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };
const espera = (p, m, ms = 8000) => p.waitFor({ timeout: ms }).then(() => ok(true, m), () => ok(false, m));
const post = (p, b) => fetch(`${MOCK}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const foto = async (page, nome) => { if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nome}.png`, fullPage: true }); };
const ola = (page) => page.getByRole('heading', { name: /^Olá/ }).waitFor();
const FOTO = fileURLToPath(new URL('./foto-teste.png', import.meta.url));

await post('/__mock/reiniciar');
const browser = await chromium.launch();
const contexto = (extra = {}) => browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...extra });
async function entrarEquipe(page, slug, email) {
  await page.goto(`${APP}/?org=${slug}`);
  await page.getByRole('button', { name: 'Sou da equipe' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('Senha@12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByLabel('Código de 6 dígitos').fill('000000');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await ola(page);
}
async function entrarPaciente(page, slug, email) {
  await page.goto(`${APP}/?org=${slug}`);
  await page.getByRole('button', { name: /Sou paciente/ }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByLabel('Código de 6 dígitos').fill('123456');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await ola(page);
}

// ── Médica-gestora: fila de revisão ──
const ctxA = await contexto();
const ana = await ctxA.newPage();
await entrarEquipe(ana, 'modelo-otorrino', 'ana@modelo-otorrino.exemplo');
await espera(ana.getByRole('heading', { name: /Resultados para revisar \(1\)/ }), 'início (equipe): seção de resultados para revisar');
const navExames = ana.getByRole('link', { name: /^Exames/ }).first();
ok(/1/.test(await navExames.innerText()), 'navegação: Exames com contador de resultados para revisar');
await navExames.click();
await ana.waitForURL(/\/exames$/);
await espera(ana.getByRole('button', { name: /Para revisar \(1\)/ }), 'lista: aba Para revisar com contador');
await espera(ana.getByText('Beatriz Costa'), 'lista: resultado da Beatriz aguardando revisão');
await foto(ana, 'fe5-1-para-revisar');
await ana.getByText('Beatriz Costa').click();
await ana.waitForURL(/\/exames\/resultados\/res_beatriz_hemograma$/);
await espera(ana.getByRole('heading', { name: 'Hemograma completo' }), 'resultado: título');
await espera(ana.getByText(/Fiz no laboratório perto de casa/), 'resultado: comentário de quem enviou');
await espera(ana.getByText(/Enviado pelo paciente/), 'resultado: origem paciente');
ok(await ana.getByRole('img', { name: /^Foto:/ }).count() >= 1, 'resultado: foto com miniatura');
await ana.getByLabel(/Nota para o paciente/).fill('Hemograma normal. Aguardamos os outros dois exames.');
await foto(ana, 'fe5-2-revisar');
await ana.getByRole('button', { name: 'Marcar como revisado' }).click();
await espera(ana.getByText(/Revisado por .*Ana/), 'revisão: autor registrado');
await espera(ana.getByText('Hemograma normal. Aguardamos os outros dois exames.'), 'revisão: nota visível');
ok(!(await ana.getByRole('button', { name: 'Marcar como revisado' }).isVisible()), 'revisão: ação some depois de revisado');
await ana.waitForFunction(() => !/\d/.test([...document.querySelectorAll('a')].find((a) => /^Exames/.test(a.textContent?.trim() ?? ''))?.textContent ?? ''), null, { timeout: 8000 }).then(() => ok(true, 'contador zera em tempo real'), () => ok(false, 'contador zera em tempo real'));

// Pedido estruturado para o Marcos.
await ana.goto(`${APP}/exames`);
await ana.getByRole('link', { name: /Pedir exame/ }).click();
await ana.getByLabel('Buscar paciente').fill('Marc');
await ana.getByRole('button', { name: 'Marcos Souza' }).click();
await ana.getByLabel('Exame 1', { exact: true }).fill('Glicemia de jejum');
await ana.getByLabel('Preparo (opcional)').first().fill('Jejum de 8 horas.');
await ana.getByRole('button', { name: 'Adicionar exame' }).click();
await ana.getByLabel('Exame 2', { exact: true }).fill('Audiometria');
await ana.getByLabel(/Orientações ao paciente/).fill('Envie pelo app assim que tiver.');
await ana.getByLabel(/Observação interna/).fill('Controle pós-sinusite.');
await foto(ana, 'fe5-3-novo-pedido');
await ana.getByRole('button', { name: 'Registrar pedido' }).click();
await ana.waitForURL(/\/exames\/pedidos\//);
const urlPedido = ana.url();
await espera(ana.getByText('Aberto', { exact: true }), 'pedido: criado aberto');
await espera(ana.getByText('Glicemia de jejum'), 'pedido: item 1');
await espera(ana.getByText(/Jejum de 8 horas/), 'pedido: preparo do item');
await espera(ana.getByText(/Controle pós-sinusite/), 'pedido: observação interna para a equipe');
ok(await ana.getByRole('button', { name: 'Cancelar pedido' }).isVisible(), 'pedido: equipe pode cancelar');

// ── Paciente: pedido no início, nota da revisão, envio de foto + PDF ──
const ctxB = await contexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const bia = await ctxB.newPage();
await entrarPaciente(bia, 'modelo-otorrino', 'beatriz@exemplo.com');
await espera(bia.getByRole('heading', { name: /Pedidos de exame/ }), 'início (paciente): pedidos de exame pendentes');
await espera(bia.getByText(/Hemograma completo, Coagulograma, Eletrocardiograma/).first(), 'início: itens do pedido');
await bia.goto(`${APP}/exames/meus`);
await espera(bia.getByRole('heading', { name: 'Meus exames' }), 'meus exames: título com o termo');
await espera(bia.getByText(/Jejum de 4 horas/), 'meus exames: preparo do item');
await espera(bia.getByText(/tem nota da equipe/), 'meus exames: resultado revisado com nota');
await bia.getByRole('link', { name: /Hemograma completo.*Revisado/s }).click();
await espera(bia.getByText('Hemograma normal. Aguardamos os outros dois exames.'), 'paciente: lê a nota da revisão');
ok(!(await bia.getByText(/Observação interna/).isVisible()), 'paciente: não vê observação interna');
await foto(bia, 'fe5-4-paciente-nota');

await bia.goto(`${APP}/exames/meus`);
await bia.getByRole('link', { name: /Enviar resultado/ }).nth(1).click();
await bia.waitForURL(/\/exames\/enviar\?pedidoId=ped_beatriz_preop/);
await bia.waitForFunction(() => (document.querySelector('input[maxlength="200"]')?.value ?? '').startsWith('Hemograma completo, Coagulograma'), null, { timeout: 8000 }).then(() => ok(true, 'enviar: título sugerido pelo pedido'), () => ok(false, 'enviar: título sugerido pelo pedido'));
await bia.getByLabel('Título').fill('Coagulograma e eletrocardiograma');
await bia.getByLabel('Data da coleta (opcional)').fill('2026-11-07');
const entrada = bia.getByLabel('Arquivos do resultado');
await entrada.setInputFiles({ name: 'virus.pdf', mimeType: 'application/pdf', buffer: pdf(EICAR) });
await espera(bia.getByRole('alert').filter({ hasText: /./ }), 'enviar: PDF com vírus recusado com mensagem');
await entrada.setInputFiles(FOTO);
await espera(bia.getByRole('img', { name: /^Foto:/ }), 'enviar: prévia da foto');
await entrada.setInputFiles({ name: 'eletrocardiograma.pdf', mimeType: 'application/pdf', buffer: pdf() });
await espera(bia.getByRole('button', { name: 'Remover eletrocardiograma.pdf' }), 'enviar: PDF anexado (verificado pelo antivírus)');
await foto(bia, 'fe5-5-enviar');

// Médica na fila: o resultado chega sem recarregar.
await ana.goto(`${APP}/exames`);
await espera(ana.getByText(/Nenhum resultado aguardando revisão/), 'fila vazia antes do envio');
await bia.getByRole('button', { name: 'Enviar', exact: true }).click();
await bia.waitForURL(/\/exames\/resultados\//);
await espera(bia.getByText('Aguardando revisão', { exact: true }), 'enviado: aguardando revisão');
await espera(bia.getByText(/A equipe ainda vai revisar/), 'enviado: paciente sabe o próximo passo');
await espera(bia.getByRole('link', { name: /eletrocardiograma\.pdf/ }), 'enviado: PDF como link para baixar');
await espera(ana.getByText('Coagulograma e eletrocardiograma'), 'tempo real: resultado chega à fila da equipe');
await foto(ana, 'fe5-6-fila-tempo-real');

// ── Secretária: vê e anexa, não pede nem revisa ──
const ctxJ = await contexto();
const julia = await ctxJ.newPage();
await entrarEquipe(julia, 'modelo-otorrino', 'julia@modelo-otorrino.exemplo');
await julia.goto(`${APP}/exames`);
await espera(julia.getByRole('link', { name: /Enviar resultado/ }), 'secretária: pode anexar resultado');
ok(!(await julia.getByRole('link', { name: /Pedir exame/ }).isVisible()), 'secretária: não pede exame');
ok(!(await julia.getByRole('button', { name: /Para revisar/ }).isVisible()), 'secretária: sem fila de revisão');
await julia.goto(urlPedido);
await espera(julia.getByText('Glicemia de jejum'), 'secretária: vê o pedido');
await julia.getByText('Coagulograma e eletrocardiograma').waitFor({ state: 'detached', timeout: 1000 }).catch(() => {});
await julia.goto(`${APP}/exames`);
await julia.getByRole('button', { name: 'Resultados' }).click();
await julia.getByText('Coagulograma e eletrocardiograma').click();
ok(!(await julia.getByRole('button', { name: 'Marcar como revisado' }).isVisible()), 'secretária: não revisa');

// Cancelar pedido (médica), com motivo.
await ana.goto(urlPedido);
await ana.getByRole('button', { name: 'Cancelar pedido' }).click();
await ana.getByLabel('Motivo').fill('Paciente fez os exames em outro serviço.');
await ana.getByRole('button', { name: 'Confirmar cancelamento' }).click();
await espera(ana.getByText(/Cancelado: Paciente fez os exames em outro serviço/), 'pedido cancelado com motivo');
ok(!(await ana.getByRole('link', { name: /Enviar resultado/ }).isVisible()), 'pedido cancelado: sem envio');

// ── Vet: tutora sem envio pelo app ──
const ctxL = await contexto();
const laura = await ctxL.newPage();
await entrarPaciente(laura, 'vet-amigo', 'laura@exemplo.com');
await laura.goto(`${APP}/exames/meus`);
await espera(laura.getByText(/Jejum de 6 horas/), 'vet: tutora vê o pedido do Thor com preparo');
ok(!(await laura.getByRole('link', { name: /Enviar resultado/ }).first().isVisible()), 'vet: sem envio pela tutora');
await espera(laura.getByText(/leve-o na próxima consulta/), 'vet: orientação para entregar o resultado');
await laura.goto(`${APP}/exames/enviar`);
await espera(laura.getByText(/não recebe resultados/), 'vet: tela de envio explica a regra');

// ── Fisio: sem o módulo ──
const ctxF = await contexto();
const pedro = await ctxF.newPage();
await entrarEquipe(pedro, 'fisio-movimento', 'pedro@fisio-movimento.exemplo');
ok(!(await pedro.getByRole('link', { name: /^Exames/ }).count()), 'fisio: sem Exames na navegação');
await pedro.goto(`${APP}/exames`);
await pedro.waitForTimeout(500);
ok(!/\/exames/.test(new URL(pedro.url()).pathname) || await pedro.getByText(/não encontrad|indisponível/i).count() > 0, 'fisio: rota de exames indisponível');

await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nFE5: tudo certo');
process.exit(falhas ? 1 : 0);
