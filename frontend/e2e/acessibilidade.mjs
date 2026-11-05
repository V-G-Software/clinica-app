// E2E 11 (PROMPT_FRONTEND, seção 16): auditoria axe-core (WCAG 2.2 A/AA) nas telas principais dos
// 3 cenários, em claro e escuro. Falha com violação "serious" ou "critical".
// Uso: node e2e/acessibilidade.mjs [--relatorio arquivo.json]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const APP = process.env.E2E_APP ?? 'http://localhost:5173';
const MOCK = process.env.E2E_MOCK ?? 'http://localhost:4010';
const iRel = process.argv.indexOf('--relatorio');
const RELATORIO = iRel > 0 ? process.argv[iRel + 1] : null;
await fetch(`${MOCK}/__mock/reiniciar`, { method: 'POST' });

const browser = await chromium.launch();
const achados = [];
async function auditar(page, rotulo) {
  // Não espere "rede ociosa": o SSE do tempo real mantém uma conexão aberta para sempre.
  await page.locator('main, h1').first().waitFor().catch(() => undefined);
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return res.violations.map((v) => ({ id: v.id, impacto: v.impact, ajuda: v.help, alvos: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary ?? '').split('\n').slice(1, 2).join('')) }));
  });
  const graves = r.filter((v) => v.impacto === 'serious' || v.impacto === 'critical');
  console.log(`${graves.length ? '✗' : '✓'} ${rotulo}${r.length ? ` (${r.map((v) => `${v.id}:${v.impacto}`).join(', ')})` : ''}`);
  achados.push({ tela: rotulo, violacoes: r });
  return graves.length;
}
async function entrar(page, slug, email, equipe) {
  await page.goto(`${APP}/?org=${slug}`);
  await page.getByRole('button', { name: equipe ? 'Sou da equipe' : /Sou paciente/ }).click();
  await page.getByLabel('E-mail').fill(email);
  if (equipe) { await page.getByLabel('Senha').fill('Senha@12345'); await page.getByRole('button', { name: 'Entrar' }).click(); }
  else await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByLabel('Código de 6 dígitos').fill(equipe ? '000000' : '123456');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: /^Olá/ }).waitFor();
}

let graves = 0;
const CENARIOS = [
  ['modelo-otorrino', 'ana@modelo-otorrino.exemplo', 'marcos@exemplo.com'],
  ['fisio-movimento', 'pedro@fisio-movimento.exemplo', 'fernanda@exemplo.com'],
  ['vet-amigo', 'renata@vet-amigo.exemplo', 'laura@exemplo.com'],
];
for (const esquema of ['light', 'dark']) {
  for (const [slug, equipe, paciente] of CENARIOS) {
    const novo = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: esquema, locale: 'pt-BR' });
    // Login
    let ctx = await novo(); let p = await ctx.newPage();
    await p.goto(`${APP}/?org=${slug}`); await p.getByRole('button', { name: 'Sou da equipe' }).waitFor();
    graves += await auditar(p, `${slug}/${esquema} login`);
    // Paciente
    await entrar(p, slug, paciente, false);
    graves += await auditar(p, `${slug}/${esquema} início paciente`);
    const responder = p.getByRole('link', { name: /Responder dia/ }).first();
    if (await responder.count()) { await responder.click(); await p.getByRole('heading', { name: /do dia/ }).waitFor(); graves += await auditar(p, `${slug}/${esquema} check-in`); }
    await p.goto(`${APP}/conversas`); await p.getByRole('heading', { level: 1 }).waitFor();
    const conv = p.locator('main a[href^="/conversas/"]').first();
    await conv.waitFor({ timeout: 5000 }).catch(() => undefined);
    if (await conv.count()) { await conv.click(); await p.getByRole('textbox', { name: 'Mensagem' }).waitFor({ timeout: 5000 }).catch(() => undefined); graves += await auditar(p, `${slug}/${esquema} conversa paciente`); }
    await p.goto(`${APP}/perfil`); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} perfil`);
    await ctx.close();
    // Equipe (desktop)
    ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: esquema, locale: 'pt-BR' }); p = await ctx.newPage();
    await entrar(p, slug, equipe, true);
    graves += await auditar(p, `${slug}/${esquema} início equipe`);
    for (const [rota, nome] of [['/pacientes', 'pacientes'], ['/acompanhamentos', 'acompanhamentos'], ['/protocolos', 'protocolos'], ['/notificacoes', 'notificações']]) {
      await p.goto(`${APP}${rota}`); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} ${nome}`);
    }
    await p.goto(`${APP}/acompanhamentos`);
    const acp = p.locator('main a[href^="/acompanhamentos/acp_"]').first();
    await acp.waitFor({ timeout: 5000 }).catch(() => undefined);
    if (await acp.count()) { await acp.click(); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} acompanhamento`); }
    await p.goto(`${APP}/pacientes/novo`); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} novo paciente`);
    for (const [rota, nome] of [['/conversas', 'conversas equipe'], ['/configuracoes', 'configurações'], ['/equipe', 'equipe']]) {
      await p.goto(`${APP}${rota}`);
      if (await p.getByRole('heading', { name: 'Página indisponível' }).isVisible().catch(() => false)) continue; // módulo/perfil sem acesso
      await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} ${nome}`);
    }
    await ctx.close();
  }
}
await browser.close();
if (RELATORIO) writeFileSync(RELATORIO, JSON.stringify(achados, null, 2));
console.log(graves ? `\n${graves} violação(ões) grave(s)` : '\nAcessibilidade: nenhuma violação grave');
process.exit(graves ? 1 : 0);
