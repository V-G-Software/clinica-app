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
/** Título da tela já roteada (a inicialização mostra um h1 "Carregando…" antes do guarda do router). */
const titulo = (p) => p.getByRole('heading', { level: 1 }).filter({ hasNotText: 'Carregando' }).first().waitFor();
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
    for (const [rota, nome] of [['/agenda/minhas', 'minhas consultas'], ['/agenda/marcar', 'marcar consulta'], ['/exames/meus', 'meus exames'], ['/exames/enviar', 'enviar resultado'], ['/documentos/meus', 'meus documentos']]) {
      await p.goto(`${APP}${rota}`);
      await titulo(p);
      if (p.url().includes('/indisponivel')) continue; // sem agenda ou sem autoagendamento
      await p.locator('.animate-pulse').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined); graves += await auditar(p, `${slug}/${esquema} ${nome}`);
    }
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
    await p.goto(`${APP}/agenda`);
    await titulo(p);
    if (!p.url().includes('/indisponivel')) {
      await p.getByRole('button', { name: 'Semana', exact: true }).click();
      const agd = p.locator('main a[href^="/agenda/agd_"]').first();
      await agd.waitFor({ timeout: 5000 }).catch(() => undefined);
      if (await agd.count()) { await agd.click(); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} agendamento`); }
    }
    await p.goto(`${APP}/exames`);
    await titulo(p);
    if (!p.url().includes('/indisponivel')) {
      const res = p.locator('main a[href^="/exames/resultados/"]').first();
      await res.waitFor({ timeout: 5000 }).catch(() => undefined);
      if (await res.count()) { await res.click(); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} resultado de exame`); }
      await p.goto(`${APP}/exames`); await titulo(p);
      await p.getByRole('button', { name: 'Pedidos', exact: true }).click();
      const ped = p.locator('main a[href^="/exames/pedidos/"]').first();
      await ped.waitFor({ timeout: 5000 }).catch(() => undefined);
      if (await ped.count()) { await ped.click(); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} pedido de exame`); }
    }
    await p.goto(`${APP}/documentos`);
    await titulo(p);
    if (!p.url().includes('/indisponivel')) {
      await p.getByRole('button', { name: 'Assinados', exact: true }).click();
      const doc = p.locator('main a[href^="/documentos/doc_"]').first();
      await doc.waitFor({ timeout: 5000 }).catch(() => undefined);
      if (await doc.count()) { await doc.click(); await p.getByRole('heading', { level: 1 }).waitFor(); graves += await auditar(p, `${slug}/${esquema} documento assinado`); }
    }
    for (const [rota, nome] of [['/conversas', 'conversas equipe'], ['/configuracoes', 'configurações'], ['/equipe', 'equipe'], ['/agenda', 'agenda'], ['/agenda/novo', 'nova consulta'], ['/agenda/servicos', 'serviços'], ['/agenda/grade', 'horários e bloqueios'], ['/exames', 'exames'], ['/exames/novo', 'novo pedido de exame'], ['/documentos', 'documentos'], ['/documentos/novo', 'receita ou atestado']]) {
      await p.goto(`${APP}${rota}`);
      await titulo(p);
      if (p.url().includes('/indisponivel')) continue; // módulo/perfil sem acesso
      await p.locator('.animate-pulse').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
      graves += await auditar(p, `${slug}/${esquema} ${nome}`);
    }
    await ctx.close();
  }
}
await browser.close();
if (RELATORIO) writeFileSync(RELATORIO, JSON.stringify(achados, null, 2));
console.log(graves ? `\n${graves} violação(ões) grave(s)` : '\nAcessibilidade: nenhuma violação grave');
process.exit(graves ? 1 : 0);
