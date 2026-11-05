// Build de produção servido com a CSP da borda (vite preview --mode homologacao): percorre os fluxos
// principais e falha se o navegador bloquear qualquer coisa (securitypolicyviolation).
// Pré-requisitos: mock no ar e `vite build --mode homologacao && vite preview --mode homologacao --port 4173`.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = process.env.E2E_APP ?? 'http://localhost:4173';
const MOCK = process.env.E2E_MOCK ?? 'http://localhost:4010';
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };
await fetch(`${MOCK}/__mock/reiniciar`, { method: 'POST' });
const browser = await chromium.launch();
const violacoes = [];
async function novaPagina(extra = {}) {
  const ctx = await browser.newContext({ locale: 'pt-BR', ...extra });
  await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP-VIOLACAO ${e.violatedDirective} ${e.blockedURI}`)));
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.text().includes('CSP-VIOLACAO') || m.text().includes('Content Security Policy')) violacoes.push(m.text()); });
  return p;
}
const ola = (p) => p.getByRole('heading', { name: /^Olá/ }).waitFor();

// Cabeçalho presente.
const r = await fetch(`${APP}/?org=modelo-otorrino`);
const csp = r.headers.get('content-security-policy') ?? '';
ok(/script-src 'self'/.test(csp) && !/unsafe/.test(csp), `CSP servida sem unsafe-inline/eval`);

// Paciente: login, check-in com foto, conversa.
let p = await novaPagina({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await p.goto(`${APP}/?org=modelo-otorrino`);
await p.getByRole('button', { name: /Sou paciente/ }).click();
await p.getByLabel('E-mail').fill('marcos@exemplo.com');
await p.getByRole('button', { name: 'Enviar código' }).click();
await p.getByLabel('Código de 6 dígitos').fill('123456');
await p.getByRole('button', { name: 'Continuar' }).click();
await ola(p);
ok(true, 'paciente entrou (build de produção)');
await p.getByRole('link', { name: /Responder dia 3/ }).click();
for (const [campo, valor] of [[null, '6'], [null, 'Regular'], [null, 'Leve'], [null, 'Não']]) { void campo; await p.getByRole('radio', { name: valor }).click(); await p.getByRole('button', { name: 'Próxima' }).click(); }
// Foto: envio para a URL assinada (connect-src) e prévia em blob: (img-src).
const png = readFileSync(new URL('./foto-teste.png', import.meta.url));
await p.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
await p.getByRole('img', { name: 'Foto enviada' }).waitFor({ timeout: 15000 }).then(() => ok(true, 'foto enviada para a URL assinada e exibida'), () => ok(false, 'foto enviada'));
await p.getByRole('button', { name: 'Próxima' }).click();
await p.getByRole('button', { name: 'Revisar' }).click();
await p.getByRole('button', { name: 'Enviar para a equipe' }).click();
await p.getByRole('heading', { name: 'Recebido!' }).waitFor();
ok(true, 'check-in com foto enviado');
await p.goto(`${APP}/conversas`);
await p.locator('main a[href^="/conversas/"]').first().click();
await p.getByRole('textbox', { name: 'Mensagem' }).fill('Teste com CSP ativa.');
await p.getByRole('button', { name: 'Enviar', exact: true }).click();
await p.getByText('Teste com CSP ativa.').waitFor();
ok(true, 'mensagem enviada e tempo real conectado');
await p.context().close();

// Equipe: telas com QR (data:), diálogo (reka-ui), configurações.
p = await novaPagina({ viewport: { width: 1280, height: 860 } });
await p.goto(`${APP}/?org=modelo-otorrino`);
await p.getByRole('button', { name: 'Sou da equipe' }).click();
await p.getByLabel('E-mail').fill('ana@modelo-otorrino.exemplo');
await p.getByLabel('Senha').fill('Senha@12345');
await p.getByRole('button', { name: 'Entrar' }).click();
await p.getByLabel('Código de 6 dígitos').fill('000000');
await p.getByRole('button', { name: 'Continuar' }).click();
await ola(p);
await p.goto(`${APP}/pacientes/pac_paulo`);
await p.getByRole('button', { name: 'Mostrar QR code' }).click();
await p.getByRole('img', { name: 'QR code do convite' }).waitFor().then(() => ok(true, 'QR code (data:) dentro de diálogo'), () => ok(false, 'QR code'));
await p.keyboard.press('Escape');
for (const rota of ['/acompanhamentos/acp_marcos', '/protocolos/prt_septo7', '/configuracoes', '/equipe', '/notificacoes']) { await p.goto(`${APP}${rota}`); await p.getByRole('heading', { level: 1 }).first().waitFor(); }
ok(true, 'telas da equipe abertas');
await p.context().close();
await browser.close();

ok(violacoes.length === 0, `nenhuma violação de CSP${violacoes.length ? `:\n  ${[...new Set(violacoes)].join('\n  ')}` : ''}`);
console.log(falhas ? `\n${falhas} falha(s)` : '\nCSP: todos os fluxos passaram com a política ativa');
process.exit(falhas ? 1 : 0);
