// E2E de documentos (F6, ADR-0018) contra o mock. Médica: rascunho no início, atestado com regra do CID,
// assinatura em lote (ida ao PSC simulado e volta ao app), anulação. Paciente: receita pelo chat, "Meus
// documentos", anulado sinalizado. Secretária sem acesso; vet só com receita; fisio sem o módulo.
// Uso: node e2e/fe6.mjs [capturas]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
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

// ── Médica: rascunho no início e atestado novo ──
const ctxA = await contexto();
const ana = await ctxA.newPage();
await entrarEquipe(ana, 'modelo-otorrino', 'ana@modelo-otorrino.exemplo');
await espera(ana.getByRole('heading', { name: /Documentos para assinar \(1\)/ }), 'início: seção de documentos para assinar');
await ana.goto(`${APP}/pacientes/pac_marcos`);
await ana.getByRole('link', { name: /Receita ou atestado/ }).click();
await ana.waitForURL(/\/documentos\/novo\?pacienteId=pac_marcos/);
await espera(ana.getByText('Marcos Souza'), 'novo: paciente vindo da ficha');
await ana.getByRole('button', { name: 'Atestado', exact: true }).click();
await ana.getByLabel('Dias').fill('3');
await ana.getByLabel('CID (opcional)').fill('J01');
await ana.getByRole('button', { name: 'Salvar rascunho' }).click();
await espera(ana.getByText(/autorização expressa do paciente/).last(), 'CID sem autorização: bloqueado no app (CFM 1.658/2002)');
await ana.getByLabel(/autorizou expressamente incluir o CID/).check();
await foto(ana, 'fe6-1-novo-atestado');
await ana.getByRole('button', { name: 'Salvar rascunho' }).click();
await ana.waitForURL(/\/documentos\/doc_/);
await espera(ana.getByText('Rascunho', { exact: true }), 'rascunho do atestado criado');
await espera(ana.getByText(/Afastamento de 3 dias/), 'detalhe: resumo do atestado');

// ── Assinatura em lote: ida ao PSC simulado e volta ao app ──
await ana.goto(`${APP}/documentos`);
await espera(ana.getByText('Beatriz Costa · Receita'), 'para assinar: receita da Beatriz');
await espera(ana.getByText('Marcos Souza · Atestado'), 'para assinar: atestado do Marcos');
await espera(ana.getByText(/Certificado digital: .*teste/), 'provedor de assinatura anunciado');
await ana.getByLabel(/Selecionar todos/).check();
await foto(ana, 'fe6-2-lote');
await ana.getByRole('button', { name: 'Assinar 2 documentos' }).click();
await ana.waitForURL(/\/documentos\?assinatura=ass_/, { timeout: 15000 }).then(() => ok(true, 'volta do provedor ao app com ?assinatura='), () => ok(false, 'volta do provedor ao app'));
await espera(ana.getByText(/2 documentos assinados e enviados ao paciente/), 'aviso: lote assinado e enviado');
await espera(ana.getByText('Nenhum rascunho para assinar.'), 'nada mais para assinar');
await foto(ana, 'fe6-3-assinado');
await ana.getByRole('button', { name: 'Assinados', exact: true }).click();
await ana.getByText('Beatriz Costa · Receita').click();
await espera(ana.getByText(/Código de validação:/), 'detalhe assinado: código de validação');
await espera(ana.getByRole('link', { name: /PDF assinado/ }), 'detalhe assinado: PDF para baixar');
await espera(ana.getByText(/Entregue na conversa/), 'entregue pela conversa');
const codigo = (await ana.locator('strong.font-mono').innerText()).trim();
const v = await fetch(`${MOCK}/o/modelo-otorrino/v1/publico/documentos/${codigo}`).then((r) => r.json());
ok(v.situacao === 'VALIDO' && v.pacienteIniciais === 'B. C.', 'validação pública: válido, só iniciais');

// ── Paciente: receita pelo chat e em "Meus documentos" ──
const ctxB = await contexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const bia = await ctxB.newPage();
await entrarPaciente(bia, 'modelo-otorrino', 'beatriz@exemplo.com');
await bia.goto(`${APP}/conversas`);
await bia.locator('main a[href^="/conversas/"]').first().click();
await espera(bia.getByRole('link', { name: /Receita \(PDF\)/ }), 'chat: receita chega como link do PDF');
await foto(bia, 'fe6-4-chat');
await bia.goto(`${APP}/documentos/meus`);
await espera(bia.getByRole('heading', { name: 'Meus documentos' }), 'meus documentos');
await espera(bia.getByRole('link', { name: 'Baixar PDF' }), 'paciente baixa o PDF');
ok(!(await bia.getByText('Rascunho').count()), 'paciente não vê rascunho');
await foto(bia, 'fe6-5-meus');

// Anulação pela médica: o paciente vê sinalizado.
await ana.getByRole('button', { name: 'Anular' }).click();
await ana.getByLabel('Motivo').fill('Posologia ajustada; nova receita enviada.');
await ana.getByRole('button', { name: 'Confirmar anulação' }).click();
await espera(ana.getByText(/Anulado.*Posologia ajustada/), 'anulada com motivo');
await bia.reload();
await espera(bia.getByText(/Anulado pela equipe/), 'paciente vê o anulado sinalizado (tempo real/recarga)');
const v2 = await fetch(`${MOCK}/o/modelo-otorrino/v1/publico/documentos/${codigo}`).then((r) => r.json());
ok(v2.situacao === 'ANULADO', 'validação pública: anulado');

// ── Secretária sem acesso ──
const ctxJ = await contexto();
const julia = await ctxJ.newPage();
await entrarEquipe(julia, 'modelo-otorrino', 'julia@modelo-otorrino.exemplo');
ok(!(await julia.getByRole('link', { name: /^Documentos/ }).count()), 'secretária: sem Documentos no menu');
await julia.goto(`${APP}/documentos`);
await julia.waitForTimeout(400);
ok(!(await julia.getByRole('heading', { name: 'Documentos', exact: true }).count()), 'secretária: rota bloqueada');

// ── Vet: só receita ──
const ctxR = await contexto();
const renata = await ctxR.newPage();
await entrarEquipe(renata, 'vet-amigo', 'renata@vet-amigo.exemplo');
await renata.goto(`${APP}/documentos/novo`);
await espera(renata.getByRole('heading', { name: 'Nova receita' }), 'vet: só receita habilitada');
ok(!(await renata.getByRole('button', { name: 'Atestado', exact: true }).count()), 'vet: sem atestado');

// ── Fisio: sem o módulo ──
const ctxF = await contexto();
const pedro = await ctxF.newPage();
await entrarEquipe(pedro, 'fisio-movimento', 'pedro@fisio-movimento.exemplo');
ok(!(await pedro.getByRole('link', { name: /^Documentos/ }).count()), 'fisio: sem Documentos no menu');

await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nFE6: tudo certo');
process.exit(falhas ? 1 : 0);
