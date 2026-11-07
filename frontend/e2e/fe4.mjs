// E2E da agenda (F4, ADR-0016) contra o mock. Relógio do mock: domingo, 2026-11-08 10:30 em São Paulo.
// Equipe: agenda da semana, marcar (horário livre), conflito 409 → encaixe, remarcar, cancelar, realizar.
// Gestor: serviço novo, grade, bloqueio. Paciente: próxima consulta no início, confirmar, marcar sozinho.
// Organização sem autoagendamento (vet) e sem o módulo (fisio). Uso: node e2e/fe4.mjs [capturas]
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
const contexto = (extra = {}) => browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'Asia/Tokyo', ...extra });
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
/** Primeiro horário livre oferecido (botões com hh:mm). */
const primeiroHorario = (page) => page.getByRole('button', { name: /^\d{2}:\d{2}/ }).first();

// ── Equipe (secretária) ──
// O aparelho está em Tóquio (timezoneId): datas e horas precisam sair no fuso da clínica.
const ctxJ = await contexto();
const julia = await ctxJ.newPage();
await entrarEquipe(julia, 'modelo-otorrino', 'julia@modelo-otorrino.exemplo');
await julia.getByRole('link', { name: 'Agenda' }).first().click();
await julia.waitForURL(/\/agenda$/);
await espera(julia.getByRole('heading', { name: /Domingo, 8 de novembro/ }), 'agenda: abre no dia de hoje no fuso da clínica (aparelho em Tóquio)');
await julia.getByRole('button', { name: 'Semana', exact: true }).click();
await espera(julia.getByText('Rafael Mendes').first(), 'agenda da semana: cirurgia do Rafael (sábado)');
await espera(julia.getByText('Faltou'), 'agenda da semana: falta registrada aparece');
ok(await julia.getByText('07:00').first().isVisible(), 'agenda: hora no fuso da clínica (10:00Z → 07:00)');
await julia.getByRole('button', { name: 'Próxima semana' }).click();
await espera(julia.getByText('Beatriz Costa'), 'próxima semana: rinoplastia da Beatriz');
await espera(julia.getByText(/Mostrar cancelados \(1\)/), 'agenda: contador de cancelados');
await foto(julia, 'fe4-1-semana');

// Marcar pelo horário livre.
await julia.getByRole('link', { name: /Nova consulta/ }).click();
await julia.getByLabel('Buscar paciente').fill('Marc');
await julia.getByRole('button', { name: 'Marcos Souza' }).click();
await julia.getByLabel('Serviço').selectOption({ label: 'Consulta otorrinolaringológica (30 min)' });
await julia.getByLabel('Médico').selectOption('usr_carlos');
await primeiroHorario(julia).click();
await julia.getByRole('button', { name: 'Marcar', exact: true }).click();
await julia.waitForURL(/\/agenda\/agd_/);
await espera(julia.getByText('Agendado', { exact: true }), 'marcar: consulta criada como Agendado');
await espera(julia.getByText(/Marcado.*por Júlia/), 'marcar: histórico com autoria');
const urlMarcada = julia.url();
const quando = (await julia.locator('p.text-lg').first().innerText()).trim();
await foto(julia, 'fe4-2-detalhe');

// Mesmo horário de novo, como "Outro horário": 409 HORARIO_INDISPONIVEL → encaixe.
const horaMarcada = quando.match(/(\d{2}:\d{2})/)[1];
await julia.goto(`${APP}/agenda/novo?pacienteId=pac_helena`);
await julia.getByText('Helena Duarte').waitFor();
await julia.getByLabel('Serviço').selectOption({ label: 'Consulta otorrinolaringológica (30 min)' });
await julia.getByRole('button', { name: 'Outro horário' }).click();
await julia.getByLabel('Médico').selectOption('usr_carlos');
// Dia do agendamento criado, lido do texto exibido ("Terça-feira, 10 de novembro às 10:00").
const meses = { janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const [, dia, mes] = quando.match(/(\d{1,2}) de (\p{L}+)/u);
await julia.getByLabel('Data').fill(`2026-${String(meses[mes]).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
await julia.getByLabel('Hora').fill(horaMarcada);
await julia.getByRole('button', { name: 'Marcar', exact: true }).click();
await espera(julia.getByText(/Esse horário já está ocupado para esse profissional/), 'conflito: 409 HORARIO_INDISPONIVEL tratado');
await julia.getByRole('button', { name: 'encaixe' }).click();
await julia.getByRole('button', { name: 'Marcar', exact: true }).click();
await julia.waitForURL(/\/agenda\/agd_/);
await espera(julia.getByText('Encaixe', { exact: true }), 'conflito: encaixe explícito sobrepõe');

// Remarcar o primeiro e depois cancelar.
await julia.goto(urlMarcada);
await julia.getByRole('button', { name: 'Remarcar' }).click();
const dlg = julia.getByRole('dialog');
await dlg.getByRole('button', { name: 'Próxima semana' }).click();
await primeiroHorario(dlg).click();
await dlg.getByLabel('Motivo (opcional)').fill('Pedido do paciente.');
await dlg.getByRole('button', { name: 'Remarcar', exact: true }).click();
await espera(julia.getByText(/Remarcado.*por Júlia/), 'remarcar: histórico registra a remarcação');
await espera(julia.getByText('“Pedido do paciente.”'), 'remarcar: motivo no histórico');
await julia.getByRole('button', { name: 'Cancelar', exact: true }).click();
await julia.getByRole('dialog').getByLabel('Motivo').fill('Paciente desistiu.');
await julia.getByRole('button', { name: 'Confirmar cancelamento' }).click();
await espera(julia.getByText('Cancelado', { exact: true }).first(), 'cancelar: status Cancelado');
await espera(julia.getByText('Motivo do cancelamento: Paciente desistiu.'), 'cancelar: motivo exibido');
ok(!(await julia.getByRole('button', { name: 'Remarcar' }).isVisible()), 'cancelado: sem ações (acoesPermitidas)');

// Cirurgia com pós-operatório (RN-AGE-008): nasce junto, remarcar para outro dia encerra e recria, cancelar encerra.
await julia.goto(`${APP}/agenda/novo?pacienteId=pac_helena`);
await julia.getByText('Helena Duarte').waitFor();
await julia.getByLabel('Serviço').selectOption({ label: 'Septoplastia (120 min)' });
ok(await julia.getByLabel(/Iniciar pós-operatório/).isChecked(), 'cirurgia: "iniciar pós-operatório" já marcado (protocolo sugerido pelo serviço)');
await julia.locator('option[value="prt_septo7"]').waitFor({ state: 'attached' });
ok((await julia.getByLabel('Protocolo').inputValue()) === 'prt_septo7', 'cirurgia: protocolo sugerido pré-selecionado');
await julia.getByRole('button', { name: 'Outro horário' }).click();
await julia.getByLabel('Data').fill('2026-12-01');
await julia.getByLabel('Hora').fill('07:00');
await julia.getByRole('button', { name: 'Marcar', exact: true }).click();
await julia.waitForURL(/\/agenda\/agd_/);
await espera(julia.getByRole('link', { name: /Pós-operatório.*Septoplastia — 7 dias · agendado/ }), 'cirurgia: pós-operatório ligado aparece no detalhe');
const urlCirurgia = julia.url();
const linkAcp = julia.locator('main a[href^="/acompanhamentos/"]');
const acp1 = await linkAcp.getAttribute('href');
await julia.getByRole('button', { name: 'Remarcar' }).click();
const dr = julia.getByRole('dialog');
await dr.getByRole('button', { name: 'Outro horário' }).click();
await dr.getByLabel('Data').fill('2026-12-03');
await dr.getByLabel('Hora').fill('07:00');
await espera(dr.getByText(/Outro dia: o pós-operatório atual será encerrado/), 'remarcar cirurgia: aviso de que o pós-operatório será recriado');
await dr.getByRole('button', { name: 'Remarcar', exact: true }).click();
await espera(julia.getByText(/Remarcado.*por Júlia/), 'cirurgia remarcada');
await julia.waitForFunction((h) => document.querySelector('main a[href^="/acompanhamentos/"]')?.getAttribute('href') !== h, acp1);
const acp2 = await linkAcp.getAttribute('href');
ok(acp2 !== acp1, 'remarcar cirurgia: o agendamento aponta para um novo pós-operatório');
await julia.goto(`${APP}${acp1}`);
await espera(julia.getByText(/Encerrado: Cirurgia remarcada para 03\/12\/2026/), 'pós-operatório antigo encerrado com o motivo (nada apagado)');
await julia.goto(`${APP}${acp2}`);
await espera(julia.getByRole('link', { name: 'ver na agenda' }), 'pós-operatório novo aponta para a cirurgia');
await julia.goto(urlCirurgia);
await julia.getByRole('button', { name: 'Cancelar', exact: true }).click();
await espera(julia.getByRole('dialog').getByText(/O pós-operatório ligado será encerrado/), 'cancelar cirurgia: aviso sobre o pós-operatório');
await julia.getByRole('dialog').getByLabel('Motivo').fill('Paciente desistiu.');
await julia.getByRole('button', { name: 'Confirmar cancelamento' }).click();
await espera(julia.getByRole('link', { name: /Pós-operatório.*encerrado/ }), 'cancelar cirurgia: pós-operatório encerrado');
await foto(julia, 'fe4-6-cirurgia-acompanhamento');

// Procedimento futuro: preparo visível e sem "realizado" antes do início.
await julia.goto(`${APP}/agenda/agd_beatriz_cirurgia`);
await espera(julia.getByText(/Jejum de 8 horas/), 'procedimento: preparo visível');
ok(!(await julia.getByRole('button', { name: 'Marcar como realizado' }).isVisible()), 'futuro: sem "realizado" antes do início');
await ctxJ.close();

// ── Gestor: serviço, grade e bloqueio ──
const ctxA = await contexto();
const ana = await ctxA.newPage();
await entrarEquipe(ana, 'modelo-otorrino', 'ana@modelo-otorrino.exemplo');
// Entra como médica: configurar a agenda é do perfil de gestão (permissão por perfil ativo).
await ana.goto(`${APP}/agenda/servicos`);
await ana.waitForURL(/\/indisponivel/);
ok(true, 'serviços: perfil médico não configura a agenda');
await ana.goto(`${APP}/perfil`);
await ana.getByRole('button', { name: 'Gestão da clínica' }).click();
await ola(ana);
await ana.goto(`${APP}/agenda/servicos`);
await espera(ana.getByRole('heading', { name: 'Septoplastia' }), 'serviços: lista os do cenário');
await ana.getByRole('button', { name: 'Novo serviço' }).click();
const ds = ana.getByRole('dialog');
await ds.getByLabel('Nome').fill('Videolaringoscopia');
await ds.getByLabel('Duração (minutos)').fill('40');
await ds.getByLabel(/Carlos/).check();
await ds.getByText('pode marcar pelo app').click();
await ds.getByRole('button', { name: 'Salvar' }).click();
await espera(ana.getByRole('heading', { name: 'Videolaringoscopia' }), 'serviços: criado');
await ana.getByRole('button', { name: 'Arquivar Videolaringoscopia' }).click();
await ana.getByRole('heading', { name: 'Videolaringoscopia' }).waitFor({ state: 'detached' }).then(() => ok(true, 'serviços: arquivado sai dos ativos'), () => ok(false, 'serviços: arquivado sai dos ativos'));
await ana.getByRole('button', { name: 'Arquivados' }).click();
await espera(ana.getByRole('heading', { name: 'Videolaringoscopia' }), 'serviços: arquivado aparece no filtro');

await ana.getByRole('button', { name: 'Ativos' }).click();
await ana.getByRole('link', { name: /Horários e bloqueios/ }).click();
await ana.waitForURL(/\/agenda\/grade/);
await ana.getByLabel('Médico').selectOption('usr_carlos');
await espera(ana.locator('select[aria-label="Dia da semana"]').first(), 'grade: horários do Carlos');
const antes = await ana.locator('select[aria-label="Dia da semana"]').count();
await ana.getByRole('button', { name: 'Horário', exact: true }).click();
await ana.locator('select[aria-label="Dia da semana"]').last().selectOption({ label: 'Sexta' });
await ana.getByRole('button', { name: 'Salvar horários' }).click();
await espera(ana.getByText('Horários salvos.'), 'grade: salva com If-Match');
await ana.reload();
await ana.locator('select[aria-label="Dia da semana"]').first().waitFor();
ok(await ana.locator('select[aria-label="Dia da semana"]').count() === antes + 1, 'grade: item novo persiste após recarregar');
await espera(ana.getByText(/Congresso/).or(ana.getByText(/Consciência Negra/)).first(), 'bloqueios: feriado da organização listado');
await ana.getByLabel('De', { exact: true }).fill('2026-12-21');
await ana.getByLabel('Até', { exact: true }).fill('2026-12-31');
await ana.getByLabel('Motivo (opcional)').fill('Férias');
await ana.getByRole('button', { name: 'Bloquear' }).click();
await espera(ana.getByText(/^Férias/), 'bloqueios: criado');
await ana.getByRole('button', { name: 'Remover bloqueio Férias' }).click();
await ana.getByText(/^Férias/).waitFor({ state: 'detached' }).then(() => ok(true, 'bloqueios: removido da lista'), () => ok(false, 'bloqueios: removido da lista'));
await foto(ana, 'fe4-3-grade');

await ana.goto(`${APP}/configuracoes`);
await espera(ana.getByRole('heading', { name: 'Agenda' }), 'configuração: bloco da agenda (módulo contratado)');
await ctxA.close();

// ── Paciente: próxima consulta, confirmar e marcar sozinho ──
const ctxR = await contexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const rafael = await ctxR.newPage();
await entrarPaciente(rafael, 'modelo-otorrino', 'rafael@exemplo.com');
await espera(rafael.getByText('Confirmar presença'), 'início do paciente: próxima consulta com pedido de confirmação');
await foto(rafael, 'fe4-4-inicio-paciente');
await rafael.getByText('Confirmar presença').click();
await rafael.waitForURL(/\/agenda\/agd_rafael_retorno/);
await rafael.getByRole('button', { name: 'Confirmar presença' }).click();
await espera(rafael.getByText('Confirmado', { exact: true }).first(), 'paciente confirma presença');
ok(await rafael.getByText('Observação interna').count() === 0, 'paciente não vê observação interna');
await rafael.goto(`${APP}/agenda/minhas`);
await espera(rafael.getByRole('heading', { name: 'Minhas consultas' }), 'minhas consultas (termo com gênero)');
await rafael.getByRole('link', { name: /Marcar consulta/ }).click();
await espera(rafael.getByRole('button', { name: /Consulta otorrinolaringológica/ }), 'marcar: só o serviço autoagendável');
ok(await rafael.getByRole('button', { name: /Septoplastia|Retorno/ }).count() === 0, 'marcar: procedimento e retorno não aparecem');
await rafael.getByRole('button', { name: /Consulta otorrinolaringológica/ }).click();
// Semana seguinte: fica fora do prazo mínimo de cancelamento (24 h) e o paciente pode desmarcar.
await rafael.getByRole('button', { name: 'Próxima semana' }).click();
await primeiroHorario(rafael).click();
await espera(rafael.getByText(/Traga seus exames anteriores/), 'marcar: preparo antes de confirmar');
await rafael.getByRole('button', { name: 'Marcar', exact: true }).click();
await rafael.waitForURL(/\/agenda\/agd_/);
await espera(rafael.getByText('Agendado', { exact: true }), 'paciente marcou sozinho');
await espera(rafael.getByRole('button', { name: 'Cancelar', exact: true }), 'paciente pode cancelar dentro do prazo');
await rafael.getByRole('button', { name: 'Cancelar', exact: true }).click();
await rafael.getByRole('dialog').getByLabel('Motivo').fill('Não vou conseguir ir.');
await rafael.getByRole('button', { name: 'Confirmar cancelamento' }).click();
await espera(rafael.getByText('Cancelado', { exact: true }).first(), 'paciente cancela pelo app');
await foto(rafael, 'fe4-5-paciente-marcou');
await ctxR.close();

// ── Vet sem autoagendamento: tutora vê, não marca ──
const ctxL = await contexto();
const laura = await ctxL.newPage();
await entrarPaciente(laura, 'vet-amigo', 'laura@exemplo.com');
await laura.goto(`${APP}/agenda/minhas`);
await espera(laura.getByText('Para marcar, fale com a equipe.'), 'vet: sem autoagendamento, orienta falar com a equipe');
ok(await laura.getByRole('link', { name: /Marcar/ }).count() === 0, 'vet: sem botão de marcar');
await laura.goto(`${APP}/agenda/marcar`);
await laura.waitForURL(/\/indisponivel/);
ok(true, 'vet: rota de marcar bloqueada sem permissão');
await ctxL.close();

// ── Fisio sem o módulo: nada de agenda ──
const ctxP = await contexto();
const pedro = await ctxP.newPage();
await entrarEquipe(pedro, 'fisio-movimento', 'pedro@fisio-movimento.exemplo');
ok(await pedro.getByRole('link', { name: 'Agenda' }).count() === 0, 'fisio: sem item de menu da agenda');
await pedro.goto(`${APP}/agenda`);
await pedro.waitForURL(/\/indisponivel/);
ok(true, 'fisio: /agenda indisponível sem o módulo');
await ctxP.close();

await browser.close();
console.log(falhas ? `\n${falhas} falha(s)` : '\nFE4: todos os cenários passaram');
process.exit(falhas ? 1 : 0);
