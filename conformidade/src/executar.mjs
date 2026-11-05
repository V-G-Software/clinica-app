// Executa a suíte e gera conformidade/relatorio.md e relatorio.json
// ("compatível com o contrato X.Y.Z: sim ou não", falhas e cobertura de operações).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operacoes, versaoContrato } from '@clinica/contrato-validador';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saidaVitest = path.join(raiz, '.vitest-resultado.json');
const cobertura = path.join(raiz, '.cobertura.jsonl');
rmSync(cobertura, { force: true });
rmSync(saidaVitest, { force: true });

const r = spawnSync('npx', ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${saidaVitest}`, ...process.argv.slice(2)], {
  cwd: raiz, stdio: 'inherit', env: { ...process.env, CONF_COBERTURA_ARQ: cobertura },
});

const res = existsSync(saidaVitest) ? JSON.parse(readFileSync(saidaVitest, 'utf8')) : { testResults: [] };
const testes = res.testResults.flatMap((f) => f.assertionResults.map((t) => ({ arquivo: path.relative(raiz, f.name), nome: t.fullName, status: t.status, falha: t.failureMessages?.join('\n') ?? '' })));
const erroGlobal = res.testResults.filter((f) => f.status === 'failed' && f.assertionResults.length === 0).map((f) => ({ arquivo: path.relative(raiz, f.name), nome: '(arquivo)', status: 'failed', falha: f.message }));
const falhas = [...testes.filter((t) => t.status === 'failed'), ...erroGlobal];
const usadas = existsSync(cobertura) ? readFileSync(cobertura, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const exercitadas = new Set(usadas.map((u) => u.operationId));
const todas = Object.keys(operacoes);
const naoExercitadas = todas.filter((o) => !exercitadas.has(o));
const compativel = r.status === 0 && falhas.length === 0 && testes.length > 0;
const alvo = process.env.CONF_URL_API ?? `${process.env.CONF_DIRETORIO_URL ?? 'http://localhost:4010/diretorio'} → ${process.env.CONF_SLUG ?? 'modelo-otorrino'}`;

const json = {
  contrato: versaoContrato, alvo, geradoEm: new Date().toISOString(), compativel,
  totais: { testes: testes.length, passaram: testes.filter((t) => t.status === 'passed').length, falharam: falhas.length, ignorados: testes.filter((t) => t.status !== 'passed' && t.status !== 'failed').length },
  cobertura: { operacoes: todas.length, exercitadas: exercitadas.size, naoExercitadas },
  falhas: falhas.map(({ arquivo, nome, falha }) => ({ arquivo, nome, falha: falha.split('\n').slice(0, 12).join('\n') })),
};
writeFileSync(path.join(raiz, 'relatorio.json'), JSON.stringify(json, null, 2));
const md = [
  `# Relatório de conformidade`, '',
  `**Compatível com o contrato ${versaoContrato}: ${compativel ? 'sim' : 'não'}**`, '',
  `- Alvo: \`${alvo}\``, `- Gerado em: ${json.geradoEm}`,
  `- Testes: ${json.totais.passaram}/${json.totais.testes} passaram, ${json.totais.falharam} falharam, ${json.totais.ignorados} ignorados`,
  `- Operações do contrato exercitadas: ${exercitadas.size}/${todas.length}`, '',
  ...(falhas.length ? ['## Falhas', '', ...falhas.flatMap((f) => [`### ${f.nome}`, `\`${f.arquivo}\``, '', '```', f.falha.split('\n').slice(0, 12).join('\n'), '```', ''])] : []),
  ...(naoExercitadas.length ? ['## Operações não exercitadas', '', ...naoExercitadas.map((o) => `- \`${o}\` (${operacoes[o].metodo} ${operacoes[o].caminho})`), ''] : []),
].join('\n');
writeFileSync(path.join(raiz, 'relatorio.md'), md);
console.log(`\nCompatível com o contrato ${versaoContrato}: ${compativel ? 'SIM' : 'NÃO'} — relatório em conformidade/relatorio.md`);
process.exit(compativel ? 0 : 1);
