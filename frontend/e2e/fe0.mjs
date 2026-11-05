// E2E da FE0 contra o mock: três marcas, login, menu do manifesto, sessão restaurada pelo cookie,
// guarda de rotas, renovação após o relógio avançar e duas abas renovando juntas.
// Pré-requisitos: `pnpm mock` (4010) e `pnpm --filter frontend dev` (5173).
// Uso: node e2e/fe0.mjs [pasta-das-capturas]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = process.env.E2E_APP ?? 'http://localhost:5173';
const MOCK = process.env.E2E_MOCK ?? 'http://localhost:4010';
const CAPTURAS = process.argv[2];
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) falhas++; };
const post = (p, b) => fetch(`${MOCK}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const foto = async (page, nome) => { if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nome}.png` }); };

await post('/__mock/reiniciar');
const browser = await chromium.launch();
const novoContexto = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'Asia/Tokyo' });

async function entrarEquipe(page, email) {
  await page.getByRole('button', { name: 'Sou da equipe' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('Senha@12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByLabel('Código de 6 dígitos').fill('000000');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: /^Olá/ }).waitFor();
}
async function entrarPaciente(page, email) {
  await page.getByRole('button', { name: /Sou paciente/ }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByLabel('Código de 6 dígitos').fill('123456');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: /^Olá/ }).waitFor();
}
const menuPrincipal = (page) => page.locator('nav.fixed a').allInnerTexts().then((xs) => xs.map((x) => x.split('\n').find(Boolean)?.trim()));
const acao = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acao').trim());

// 1) Três marcas, sem nenhum código específico por cliente.
const marcas = { 'modelo-otorrino': ['Clínica Modelo Otorrino', '#3B5BFD'], 'fisio-movimento': ['Fisio Movimento', '#047857'], 'vet-amigo': ['Clínica Vet Amigo', '#C2410C'] };
for (const [slug, [nome, cor]] of Object.entries(marcas)) {
  const ctx = await novoContexto();
  const page = await ctx.newPage();
  await page.goto(`${APP}/?org=${slug}`);
  await page.getByRole('heading', { name: nome }).waitFor();
  ok((await page.title()) === nome, `${slug}: título "${nome}"`);
  ok((await acao(page)) === cor, `${slug}: cor de ação ${cor} (contraste AA já atendido)`);
  ok((await page.locator('meta[name="theme-color"]').getAttribute('content')) === cor, `${slug}: theme-color`);
  ok((await page.locator('link[rel="manifest"]').getAttribute('href')) === `/manifest.webmanifest?org=${slug}`, `${slug}: manifest por organização`);
  await foto(page, `1-login-${slug}`);
  await ctx.close();
}

// 2) Equipe: menu vem do manifesto (otorrino).
{
  const ctx = await novoContexto();
  const page = await ctx.newPage();
  await page.goto(`${APP}/?org=modelo-otorrino`);
  await entrarEquipe(page, 'ana@modelo-otorrino.exemplo');
  const menu = await menuPrincipal(page);
  ok(JSON.stringify(menu) === JSON.stringify(['Início', 'Pós-operatórios', 'Conversas', 'Pacientes']), `otorrino/equipe: menu ${JSON.stringify(menu)}`);
  ok(await page.getByRole('button', { name: 'Mais' }).isVisible(), 'otorrino/equipe: itens secundários em "Mais"');
  ok(await page.getByText('Alertas abertos (1)').isVisible(), 'otorrino/equipe: seção ALERTAS_ABERTOS');
  await foto(page, '2-inicio-equipe-otorrino');

  // 3) Sessão restaurada pelo cookie de renovação ao recarregar (token só em memória).
  await page.reload();
  await page.getByRole('heading', { name: /^Olá/ }).waitFor();
  ok(page.url().endsWith('/?org=modelo-otorrino') || !page.url().includes('/entrar'), 'recarregar mantém a sessão (cookie HttpOnly)');
  const armazenado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  ok(!/ac\.|rn\.|token/i.test(armazenado), 'nenhum token em localStorage/sessionStorage');

  // 4) Relógio avança 1 dia: o token de 15 min expira e o app renova sozinho.
  await post('/__mock/relogio', { avancarDias: 1 });
  await page.getByRole('link', { name: 'Pacientes' }).first().click();
  await page.getByRole('link', { name: 'Início' }).first().click();
  await page.getByRole('heading', { name: /^Olá/ }).waitFor();
  ok(!page.url().includes('/entrar'), 'após o relógio avançar, o 401 é renovado sem pedir login');

  // 5) Duas abas recarregando ao mesmo tempo não derrubam a sessão (rotação + detecção de reuso).
  const page2 = await ctx.newPage();
  await page2.goto(`${APP}/?org=modelo-otorrino`);
  await page2.getByRole('heading', { name: /^Olá/ }).waitFor();
  await Promise.all([page.reload(), page2.reload()]);
  await Promise.all([page.getByRole('heading', { name: /^Olá/ }).waitFor(), page2.getByRole('heading', { name: /^Olá/ }).waitFor()]);
  await page.reload();
  await page.getByRole('heading', { name: /^Olá/ }).waitFor({ timeout: 8000 }).catch(() => undefined);
  ok(!page.url().includes('/entrar') && !page2.url().includes('/entrar'), 'duas abas renovando juntas continuam logadas');

  // 6) Troca de perfil muda o manifesto (Médica → Gestão).
  await page.goto(`${APP}/perfil`);
  await page.getByRole('button', { name: 'Gestão da clínica' }).click();
  await page.getByRole('heading', { name: /^Olá/ }).waitFor();
  await page.getByRole('button', { name: 'Mais' }).click();
  ok(await page.getByRole('link', { name: 'Equipe' }).isVisible(), 'perfil GESTOR mostra "Equipe" no menu');
  await ctx.close();
}

// 7) Fisio: vocabulário e módulos diferentes.
{
  const ctx = await novoContexto();
  const page = await ctx.newPage();
  await page.goto(`${APP}/?org=fisio-movimento`);
  await entrarEquipe(page, 'pedro@fisio-movimento.exemplo');
  const menu = await menuPrincipal(page);
  ok(JSON.stringify(menu) === JSON.stringify(['Início', 'Acompanhamentos', 'Conversas', 'Pacientes']), `fisio/equipe: menu ${JSON.stringify(menu)}`);
  ok(await page.getByText('Registros diários de hoje').isVisible(), 'fisio: termo "registro diário" do manifesto');
  await foto(page, '3-inicio-equipe-fisio');
  await ctx.close();
}

// 8) Vet: tutora (paciente), vocabulário de pet, guarda de rotas da equipe.
{
  const ctx = await novoContexto();
  const page = await ctx.newPage();
  await page.goto(`${APP}/?org=vet-amigo`);
  await entrarPaciente(page, 'laura@exemplo.com');
  const menu = await menuPrincipal(page);
  ok(JSON.stringify(menu) === JSON.stringify(['Início', 'Minha recuperação', 'Conversas', 'Notificações', 'Meu perfil']), `vet/tutora: menu ${JSON.stringify(menu)}`);
  ok(await page.getByText('Castração — 10 dias').isVisible(), 'vet/tutora: acompanhamento do Thor no início');
  const conversas = await page.locator('section', { hasText: 'Conversas' }).locator('li span:first-child').allInnerTexts();
  ok(conversas.includes('Thor') && conversas.includes('Mel'), `vet/tutora: conversas identificadas por pet ${JSON.stringify(conversas)}`);
  await foto(page, '4-inicio-tutora-vet');
  await page.goto(`${APP}/pacientes`);
  await page.getByRole('heading', { name: 'Página indisponível' }).waitFor();
  ok(true, 'vet/tutora: /pacientes (tela de equipe) vai para "Página indisponível"');
  await ctx.close();
}

await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nFE0: todos os cenários passaram');
process.exit(falhas ? 1 : 0);
