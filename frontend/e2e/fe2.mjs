// E2E da FE2 (telas da equipe) contra o mock. Cenários do PROMPT_FRONTEND (seção 16):
// 1 três marcas claro/escuro · 3 equipe vê alerta chegar e resolve · 7 tutora alterna pets e recebe por
// polling · 8 conflito 412 tratado · 10 duas abas · e fluxos da equipe (paciente, convite, acompanhamento,
// protocolo, equipe, configuração). Uso: node e2e/fe2.mjs [capturas]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
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
const foto = async (page, nome) => { if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nome}.png` }); };
const ola = (page) => page.getByRole('heading', { name: /^Olá/ }).waitFor();

// "Nenhum if por organização": o código não pode citar slugs nem nomes dos cenários.
const proibidos = /modelo-otorrino|fisio-movimento|vet-amigo|Otorrino|Vet Amigo|Fisio Movimento/;
const arquivos = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? arquivos(p) : [p]; });
const citam = arquivos('src').filter((f) => !f.includes(`${path.sep}dev${path.sep}`) && !f.endsWith('EscolherOrganizacao.vue') && proibidos.test(readFileSync(f, 'utf8')));
ok(citam.length === 0, `nenhum código específico por organização${citam.length ? `: ${citam.join(', ')}` : ''}`);

await post('/__mock/reiniciar');
const browser = await chromium.launch();
const contexto = (extra = {}) => browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, locale: 'pt-BR', ...extra });
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
const lateral = (page) => page.locator('nav').first();

// 1) Três marcas, claro e escuro (capturas para revisão visual).
for (const [slug, email] of [['modelo-otorrino', 'ana@modelo-otorrino.exemplo'], ['fisio-movimento', 'pedro@fisio-movimento.exemplo'], ['vet-amigo', 'renata@vet-amigo.exemplo']]) {
  for (const esquema of ['light', 'dark']) {
    const ctx = await contexto({ colorScheme: esquema, viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await entrarEquipe(p, slug, email);
    const escuro = await p.evaluate(() => document.documentElement.classList.contains('dark'));
    // fisio tem modoPadrao CLARO: ignora o esquema do sistema.
    ok(escuro === (esquema === 'dark' && slug !== 'fisio-movimento'), `${slug}/${esquema}: modo ${escuro ? 'escuro' : 'claro'} conforme modoPadrao e sistema`);
    await foto(p, `fe2-1-${slug}-${esquema}`);
    await ctx.close();
  }
}

// 3) Equipe vê o alerta chegar sem recarregar e resolve.
const ctxAna = await contexto();
const ana = await ctxAna.newPage();
await entrarEquipe(ana, 'modelo-otorrino', 'ana@modelo-otorrino.exemplo');
// Responde o check-in disponível do Rafael (dia 1) pelo simulador, com dor 9.
await ana.goto(`${APP}/acompanhamentos`);
await ana.getByText('Rafael Mendes').first().click();
await ana.waitForURL(/\/acompanhamentos\/acp_rafael/);
const checkinRafael = await ana.locator('a[href^="/checkins/"]').first().getAttribute('href');
await ana.goto(`${APP}/`);
await ola(ana);
// O evento só chega em tempo real com o canal aberto: espera o SSE conectar antes de simular a resposta.
const estadoTr = await ana.locator('html[data-tempo-real="conectado"]').waitFor({ state: 'attached', timeout: 15000 })
  .then(() => 'conectado', () => ana.evaluate(() => document.documentElement.dataset.tempoReal ?? 'desligado'));
ok(estadoTr === 'conectado', `tempo real: SSE conectado antes do evento (estado: ${estadoTr})`);
await post('/__mock/simular/checkin', { org: 'modelo-otorrino', checkinId: checkinRafael.split('/').pop(), respostas: { dor: 9, noite: 'MAL', sangramento: 'LEVE', mediuTemperatura: false } });
await espera(ana.getByText(/Rafael Mendes — Dor 8 ou mais relatada/), 'tempo real: alerta do Rafael aparece no início sem recarregar');
await ana.getByText(/Rafael Mendes — Dor 8 ou mais relatada/).click();
await ana.getByRole('button', { name: 'Resolver' }).first().click();
await ana.getByLabel('Nota (opcional)').fill('Liguei para o paciente.');
await ana.getByRole('button', { name: 'Marcar como resolvido' }).click();
await espera(ana.getByText(/Resolvido por Dra\. Ana Lima — Liguei para o paciente\./), 'alerta resolvido com nota e autoria');
await foto(ana, 'fe2-2-acompanhamento-alerta-resolvido');

// Fluxo da equipe: novo paciente → convite com QR → iniciar acompanhamento.
await ana.goto(`${APP}/pacientes/novo`);
await ana.getByLabel('Nome', { exact: true }).fill('Joana Prado');
await ana.getByLabel('E-mail').first().fill('joana@exemplo.com');
await ana.getByLabel('Celular').first().fill('(11) 97777-6666');
await ana.getByRole('button', { name: 'Salvar' }).click();
await ana.waitForURL(/\/pacientes\/pac_/);
await espera(ana.getByRole('heading', { name: 'Joana Prado' }), 'paciente cadastrado (celular normalizado para E.164)');
await ana.getByRole('button', { name: 'Mostrar QR code' }).click();
await espera(ana.getByRole('img', { name: 'QR code do convite' }), 'convite com QR code para mostrar na consulta');
await foto(ana, 'fe2-3-convite-qr');
await ana.keyboard.press('Escape');
await ana.getByRole('link', { name: /Iniciar pós-operatório/ }).click();
await ana.getByLabel('Protocolo').selectOption({ label: 'Septoplastia — 7 dias' });
await espera(ana.getByText('Prévia'), 'novo acompanhamento: prévia dos dias');
await foto(ana, 'fe2-4-novo-acompanhamento');
await ana.getByRole('button', { name: 'Iniciar' }).click();
await ana.waitForURL(/\/acompanhamentos\/acp_/);
await espera(ana.getByRole('heading', { name: 'Septoplastia — 7 dias' }), 'acompanhamento iniciado');

// 8) Conflito: duas sessões editam o mesmo paciente; a segunda vê o 412 tratado.
const ctxJulia = await contexto();
const julia = await ctxJulia.newPage();
await entrarEquipe(julia, 'modelo-otorrino', 'julia@modelo-otorrino.exemplo');
const urlJoana = (await ana.getByRole('link', { name: 'Joana Prado' }).getAttribute('href'));
await ana.goto(`${APP}${urlJoana}`); await julia.goto(`${APP}${urlJoana}`);
await ana.getByRole('button', { name: 'Editar' }).click(); await julia.getByRole('button', { name: 'Editar' }).click();
await ana.getByLabel('Nome social (opcional)').fill('Jo'); await ana.getByRole('button', { name: 'Salvar' }).click();
await ana.getByRole('heading', { name: 'Jo' }).waitFor();
await julia.getByLabel('Nome social (opcional)').fill('Joaninha'); await julia.getByRole('button', { name: 'Salvar' }).click();
await espera(julia.getByText(/Outra pessoa alterou este registro/), 'conflito 412: aviso exibido, sem sobrescrever');
await julia.getByRole('button', { name: 'Recarregar a versão atual' }).first().click();
await espera(julia.getByRole('heading', { name: 'Jo' }), 'conflito 412: recarrega e mostra a versão atual');
await foto(julia, 'fe2-5-conflito');
await ctxJulia.close();

// Protocolo: nova versão.
await ana.goto(`${APP}/protocolos/prt_rino10`);
await ana.getByRole('button', { name: 'Editar' }).click();
await espera(ana.getByText(/Salvar publica a versão 2/), 'protocolo: aviso de nova versão');
await ana.getByRole('button', { name: /Regra/ }).click();
const regras = ana.locator('fieldset', { hasText: 'Regras de alerta' });
const ultima = regras.locator('div.flex.flex-col.gap-2').last();
await ultima.getByLabel('Pergunta').selectOption({ label: 'Mediu a temperatura hoje?' }).catch(() => undefined);
await ultima.getByLabel('Pergunta').selectOption({ index: 1 });
await ultima.getByLabel('Valor').first().fill('7').catch(async () => { await ultima.getByLabel('Valor').first().selectOption({ index: 0 }); });
await ultima.getByLabel('Mensagem do alerta').fill('Dor 7 ou mais relatada');
await foto(ana, 'fe2-6-protocolo-edicao');
await ana.getByRole('button', { name: 'Publicar nova versão' }).click();
await espera(ana.getByText(/Versão 2 ·/), 'protocolo: versão 2 publicada');

// Equipe: convidar; o último gestor não perde o perfil.
await ana.goto(`${APP}/perfil`);
await ana.getByRole('button', { name: 'Gestão da clínica' }).click();
await ola(ana);
await ana.goto(`${APP}/equipe`);
await ana.getByRole('button', { name: 'Convidar' }).click();
await ana.getByLabel('Nome').fill('Bruno Teles');
await ana.getByLabel('E-mail').fill('bruno@modelo-otorrino.exemplo');
await ana.getByRole('button', { name: 'Enviar convite' }).click();
await espera(ana.getByText(/Bruno Teles · Convidado/), 'equipe: convite enviado');
await ana.getByRole('group', { name: 'Perfis de Dra. Ana Lima' }).getByLabel('Gestão').uncheck();
await espera(ana.getByText('A organização precisa de ao menos um gestor.'), 'equipe: ULTIMO_GESTOR tratado');
await foto(ana, 'fe2-7-equipe');

// Configuração: cor nova aplicada na hora.
await ana.goto(`${APP}/configuracoes`);
await ana.getByLabel('Código').fill('#7C3AED');
await ana.getByRole('button', { name: 'Salvar' }).click();
await espera(ana.getByText(/Salvo\./), 'configuração salva');
await ana.waitForTimeout(500);
ok((await ana.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acao').trim())) === '#7C3AED', 'configuração: nova cor aplicada sem recarregar');
await foto(ana, 'fe2-8-configuracao');
// QUESTION-019: opção de resolver alertas ao encerrar — salva, persiste e o diálogo de encerrar avisa.
const opcaoAlertas = ana.getByLabel(/Resolver os alertas abertos ao encerrar/);
ok(!(await opcaoAlertas.isChecked()), 'configuração: resolver alertas ao encerrar vem desligado');
await opcaoAlertas.check();
await ana.getByRole('button', { name: 'Salvar' }).click();
await ana.getByText(/Salvo\./).waitFor();
await ana.reload();
await opcaoAlertas.waitFor();
ok(await opcaoAlertas.isChecked(), 'configuração: resolver alertas ao encerrar salvo');
await ana.goto(`${APP}/acompanhamentos/acp_rafael`);
await ana.getByRole('button', { name: 'Encerrar' }).click();
await espera(ana.getByText(/Os alertas abertos serão marcados como resolvidos por você/), 'encerrar: diálogo avisa que os alertas serão resolvidos');
await ana.keyboard.press('Escape');

// 10) Duas abas na mesma sessão.
const ana2 = await ctxAna.newPage();
await ana2.goto(`${APP}/`);
await Promise.all([ana.reload(), ana2.reload()]);
await Promise.all([ana.locator('main').first().waitFor(), ana2.locator('main').first().waitFor()]);
await ana2.waitForTimeout(1500);
ok(!ana.url().includes('/entrar') && !ana2.url().includes('/entrar'), 'duas abas recarregando juntas continuam logadas');
await ctxAna.close();

// 7) Tutora alterna entre os pets e recebe mensagem por polling (vet-amigo está em POLLING).
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await entrarPaciente(p, 'vet-amigo', 'laura@exemplo.com');
  await p.getByRole('link', { name: /Minha recuperação/ }).first().click();
  await p.getByRole('button', { name: 'Mel' }).click();
  await espera(p.getByText(/Mel · Encerrado/), 'tutora: filtro mostra o acompanhamento da Mel');
  await p.getByRole('button', { name: 'Thor' }).click();
  await espera(p.getByText(/Thor · Em andamento/), 'tutora: filtro mostra o do Thor');
  await p.getByRole('link', { name: /Conversas/ }).first().click();
  // Espera a rota trocar: a tela de conversas é carregada sob demanda e, até lá, o card "Thor" de /meus ainda está no DOM.
  await p.waitForURL(/\/conversas$/);
  await p.getByRole('link', { name: /Thor/ }).first().click();
  await p.waitForURL(/\/conversas\/.+/);
  const conversaId = p.url().split('/').pop();
  await p.getByRole('textbox', { name: 'Mensagem' }).waitFor();
  await post('/__mock/simular/mensagem', { org: 'vet-amigo', conversaId, autorId: 'usr_renata', texto: 'Laura, a foto da ferida está ótima.' });
  await espera(p.getByText('Laura, a foto da ferida está ótima.'), 'polling: mensagem chega à tutora sem recarregar (intervalo de 15 s)', 25000);
  await foto(p, 'fe2-9-tutora-polling');
  await ctx.close();
}

await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nFE2: todos os cenários passaram');
process.exit(falhas ? 1 : 0);
