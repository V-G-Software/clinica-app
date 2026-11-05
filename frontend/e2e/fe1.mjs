// E2E da FE1 (telas do paciente) contra o mock. Cenários do PROMPT_FRONTEND (seção 16):
// 2 check-in do paciente · 4 relógio/renovação · 5 convite + onboarding · 6 primeiro acesso ·
// 9 mensagem offline reenviada sem duplicar · e tempo real paciente → equipe sem recarregar.
// Pré-requisitos: `pnpm mock` e `pnpm --filter frontend dev`. Uso: node e2e/fe1.mjs [capturas]
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
const post = (p, b) => fetch(`${MOCK}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const foto = async (page, nome) => { if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nome}.png` }); };
const ola = (page) => page.getByRole('heading', { name: /^Olá/ }).waitFor();

await post('/__mock/reiniciar');
const browser = await chromium.launch();
const contexto = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' });

async function entrarPaciente(page, email) {
  await page.goto(`${APP}/?org=modelo-otorrino`);
  await page.getByRole('button', { name: /Sou paciente/ }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.getByLabel('Código de 6 dígitos').fill('123456');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await ola(page);
}
async function entrarEquipe(page, email, senha = 'Senha@12345') {
  await page.goto(`${APP}/?org=modelo-otorrino`);
  await page.getByRole('button', { name: 'Sou da equipe' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

// Equipe (Ana) aberta antes, para ver o tempo real.
const ctxAna = await contexto();
const ana = await ctxAna.newPage();
await entrarEquipe(ana, 'ana@modelo-otorrino.exemplo');
await ana.getByLabel('Código de 6 dígitos').fill('000000');
await ana.getByRole('button', { name: 'Continuar' }).click();
await ola(ana);
ok(!(await ana.getByText('Sangramento intenso relatado').isVisible()), 'equipe: ainda sem alerta de sangramento');

// 2) Paciente responde o check-in do dia 3.
const ctxMarcos = await contexto();
const marcos = await ctxMarcos.newPage();
await entrarPaciente(marcos, 'marcos@exemplo.com');
await marcos.getByRole('link', { name: /Responder dia 3/ }).click();
await marcos.getByRole('heading', { name: /Check-in do dia 3/ }).waitFor();
await foto(marcos, 'fe1-1-checkin-pergunta');
await marcos.getByRole('button', { name: 'Próxima' }).click();
ok(await marcos.getByText('Responda esta pergunta para continuar.').isVisible(), 'check-in: obrigatório não deixa avançar');
await marcos.getByRole('radio', { name: '6' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
await marcos.getByRole('radio', { name: 'Regular' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
await marcos.getByRole('radio', { name: 'Intenso' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
await marcos.getByRole('radio', { name: 'Não' }).click(); await marcos.getByRole('button', { name: 'Próxima' }).click();
ok(!(await marcos.getByText('Qual foi a temperatura?').isVisible()), 'check-in: temperatura escondida (visivelSe)');
await marcos.getByRole('button', { name: 'Próxima' }).click(); // foto (opcional)
await marcos.getByRole('button', { name: 'Revisar' }).click(); // observação (opcional)
await marcos.getByRole('heading', { name: 'Confira suas respostas' }).waitFor();
await foto(marcos, 'fe1-2-checkin-revisao');
await marcos.getByRole('button', { name: 'Enviar para a equipe' }).click();
await marcos.getByRole('heading', { name: 'Recebido!' }).waitFor();
ok(true, 'check-in: enviado com confirmação');
ok(!(await marcos.getByText(/alerta|ALTA|Sangramento intenso relatado/i).count()), 'check-in: paciente não vê alerta nem interpretação');
await foto(marcos, 'fe1-3-checkin-recebido');

// Tempo real: o alerta aparece para a equipe sem recarregar.
await ana.getByText('Sangramento intenso relatado').waitFor({ timeout: 8000 }).then(() => ok(true, 'tempo real: alerta chegou à equipe sem recarregar'), () => ok(false, 'tempo real: alerta chegou à equipe sem recarregar'));

// Chat: mensagem do paciente chega à conversa aberta da equipe.
await marcos.goto(`${APP}/conversas`);
await marcos.getByRole('link', { name: /Clínica Modelo Otorrino/ }).first().click();
await marcos.waitForURL(/\/conversas\/.+/);
await marcos.getByRole('textbox', { name: 'Mensagem' }).waitFor();
ok(await marcos.getByRole('note').isVisible(), 'chat: aviso de urgência fixo para o paciente');
const conversaUrl = marcos.url().replace(APP, '');
await ana.goto(`${APP}${conversaUrl}`);
await ana.getByRole('textbox', { name: 'Mensagem' }).waitFor().catch(async (e) => { await ana.screenshot({ path: '/tmp/claude-0/-home-user-clinica-app/6454b5fb-150c-5c66-b6b6-11b065973ec2/scratchpad/ana-falha.png' }); throw e; });
await marcos.getByRole('textbox', { name: 'Mensagem' }).fill('Doutora, o sangramento diminuiu agora.');
await marcos.getByRole('button', { name: 'Enviar', exact: true }).click();
await ana.getByText('Doutora, o sangramento diminuiu agora.').waitFor({ timeout: 6000 }).then(() => ok(true, 'chat: mensagem chega à equipe em tempo real'), () => ok(false, 'chat: mensagem chega à equipe em tempo real'));
await foto(marcos, 'fe1-4-chat-paciente');

// 9) Sem rede: mensagem fica pendente e é reenviada ao reconectar, sem duplicar.
await ctxMarcos.setOffline(true);
await marcos.getByRole('textbox', { name: 'Mensagem' }).fill('Mensagem escrita sem internet.');
await marcos.getByRole('button', { name: 'Enviar', exact: true }).click();
await marcos.getByText(/sem conexão/).first().waitFor();
ok(true, 'offline: mensagem marcada como pendente');
await ctxMarcos.setOffline(false);
await marcos.waitForTimeout(2500);
const vezes = await marcos.getByText('Mensagem escrita sem internet.').count();
ok(vezes === 1, `offline: reenviada ao reconectar, aparece ${vezes} vez(es)`);
await ana.getByText('Mensagem escrita sem internet.').waitFor({ timeout: 6000 }).then(() => ok(true, 'offline: equipe recebe uma vez'), () => ok(false, 'offline: equipe recebe'));
ok((await ana.getByText('Mensagem escrita sem internet.').count()) === 1, 'offline: sem duplicata do lado da equipe');

// 4) Relógio +1 dia: token expira, app renova sozinho, dia 4 aparece.
await post('/__mock/relogio', { avancarDias: 1 });
await marcos.getByRole('link', { name: 'Início' }).first().click();
await marcos.getByText('Dia 4 de 7').waitFor({ timeout: 8000 }).then(() => ok(true, 'relógio: dia 4 aparece sem novo login'), () => ok(false, 'relógio: dia 4 aparece sem novo login'));
ok(!marcos.url().includes('/entrar'), 'relógio: sessão renovada sem pedir login');
await foto(marcos, 'fe1-5-inicio-dia4');
await ctxMarcos.close(); await ctxAna.close();

// 5) Convite + onboarding (Paulo).
{
  const ctx = await contexto(); const p = await ctx.newPage();
  await p.goto(`${APP}/convite/convite-paulo-otorrino-0001?org=modelo-otorrino`);
  await p.getByText(/Paulo T\./).waitFor();
  ok(await p.getByText(/p\*\*\*@exemplo\.com/).isVisible(), 'convite: nome parcial e e-mail mascarado');
  await p.getByLabel('E-mail').fill('paulo@exemplo.com');
  await p.getByRole('checkbox').check();
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.getByRole('heading', { name: 'Instale o app' }).waitFor();
  await foto(p, 'fe1-6-onboarding');
  await p.getByRole('button', { name: 'Agora não' }).click();
  await p.getByRole('heading', { name: 'Ative as notificações' }).waitFor();
  await p.getByRole('button', { name: 'Agora não' }).click();
  await p.getByRole('button', { name: 'Começar' }).click();
  await ola(p);
  ok((await p.getByRole('heading', { name: /^Olá/ }).innerText()).includes('Paulo'), 'convite: Paulo entra no app depois do onboarding');
  await ctx.close();
}

// 6) Primeiro acesso da equipe (Carlos): TROCAR_SENHA → CONFIGURAR_MFA → ACEITAR_TERMOS → códigos.
{
  const ctx = await contexto(); const p = await ctx.newPage();
  await entrarEquipe(p, 'carlos@modelo-otorrino.exemplo', 'Provisoria@1');
  await p.getByRole('heading', { name: 'Crie uma nova senha' }).waitFor();
  await p.getByLabel('Nova senha').fill('NovaSenhaSegura2026');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.getByRole('heading', { name: 'Proteja sua conta' }).waitFor();
  ok(await p.getByRole('img', { name: /QR code/ }).isVisible(), 'primeiro acesso: QR do autenticador');
  await p.getByLabel('Código de 6 dígitos').fill('000000');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.getByRole('heading', { name: 'Termos de uso' }).waitFor();
  await p.getByRole('button', { name: 'Li e aceito' }).click();
  await p.getByRole('heading', { name: 'Guarde seus códigos de recuperação' }).waitFor();
  ok((await p.locator('li.font-mono, ul.font-mono li').count()) >= 4, 'primeiro acesso: códigos de recuperação exibidos uma vez');
  await p.getByRole('button', { name: 'Guardei os códigos' }).click();
  await ola(p);
  ok(true, 'primeiro acesso: concluído e dentro do app');
  await ctx.close();
}

await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nFE1: todos os cenários passaram');
process.exit(falhas ? 1 : 0);
