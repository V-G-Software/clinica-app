// E2E da FE3 (pronto para o piloto): estado de erro com "tentar de novo", densidade compacta e
// separação de código (o paciente não baixa telas da equipe). Acessibilidade e CSP têm scripts próprios.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = process.env.E2E_APP ?? 'http://localhost:5173';
const MOCK = process.env.E2E_MOCK ?? 'http://localhost:4010';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };
await fetch(`${MOCK}/__mock/reiniciar`, { method: 'POST' });
const browser = await chromium.launch();
const ola = (p) => p.getByRole('heading', { name: /^Olá/ }).waitFor();

// Paciente: não baixa código de telas da equipe.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const p = await ctx.newPage();
  const modulos = [];
  p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/src/telas/')) modulos.push(u.pathname); });
  await p.goto(`${APP}/?org=modelo-otorrino`);
  await p.getByRole('button', { name: /Sou paciente/ }).click();
  await p.getByLabel('E-mail').fill('marcos@exemplo.com');
  await p.getByRole('button', { name: 'Enviar código' }).click();
  await p.getByLabel('Código de 6 dígitos').fill('123456');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await ola(p);
  for (const rota of ['/meus', '/conversas', '/notificacoes', '/perfil', '/acompanhamentos/acp_marcos']) { await p.goto(`${APP}${rota}`); await p.getByRole('heading', { level: 1 }).first().waitFor(); }
  const daEquipe = modulos.filter((m) => /\/telas\/(pacientes|equipe|organizacao)\/|\/telas\/acompanhamento\/(Lista|Novo|Protocolo|Protocolos)\.vue/.test(m));
  ok(daEquipe.length === 0, `paciente não baixa telas da equipe${daEquipe.length ? `: ${daEquipe.join(', ')}` : ''}`);
  await ctx.close();
}

// Equipe: erro de servidor com tentar de novo; densidade compacta.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await p.goto(`${APP}/?org=modelo-otorrino`);
  await p.getByRole('button', { name: 'Sou da equipe' }).click();
  await p.getByLabel('E-mail').fill('ana@modelo-otorrino.exemplo');
  await p.getByLabel('Senha').fill('Senha@12345');
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.getByLabel('Código de 6 dígitos').fill('000000');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await ola(p);

  // Falha injetada pelo cabeçalho X-Mock-Erro do mock (503 no formato do contrato).
  let falhar = true;
  await p.route('**/v1/pacientes?**', (rota) => rota.continue({ headers: { ...rota.request().headers(), ...(falhar ? { 'x-mock-erro': '503' } : {}) } }));
  await p.goto(`${APP}/pacientes`);
  await p.getByText('Serviço indisponível no momento. Tente de novo.').waitFor({ timeout: 15000 }).then(() => ok(true, 'erro 503: mensagem pelo código e botão de tentar de novo'), () => ok(false, 'erro 503 exibido'));
  ok(await p.getByText(/Código para o suporte: /).isVisible(), 'erro: requestId exibido para o suporte');
  falhar = false;
  await p.getByRole('button', { name: 'Tentar de novo' }).click();
  await p.getByText('Marcos Souza').first().waitFor({ timeout: 8000 }).then(() => ok(true, 'tentar de novo recupera a lista'), () => ok(false, 'tentar de novo'));

  // Densidade compacta (preferência da equipe).
  const alturaAntes = await p.locator('main a[href^="/pacientes/pac_"]').first().evaluate((e) => e.getBoundingClientRect().height);
  await p.goto(`${APP}/perfil`);
  await p.getByRole('button', { name: 'Compacta' }).click();
  await p.waitForFunction(() => document.documentElement.classList.contains('compacta'));
  await p.goto(`${APP}/pacientes`);
  const alturaDepois = await p.locator('main a[href^="/pacientes/pac_"]').first().evaluate((e) => e.getBoundingClientRect().height);
  ok(alturaDepois < alturaAntes && alturaDepois >= 40, `densidade compacta: linha de ${alturaAntes}px para ${alturaDepois}px (alvo ≥ 40px)`);
  await p.goto(`${APP}/perfil`);
  await p.getByRole('button', { name: 'Confortável' }).click();
  await ctx.close();
}
await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nFE3: todos os cenários passaram');
process.exit(falhas ? 1 : 0);
