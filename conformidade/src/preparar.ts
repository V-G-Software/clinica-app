// globalSetup: resolve o alvo, entra como gestor e cria dois pacientes de teste com conta no app.
// As sessões são compartilhadas com os testes via provide/inject (um login TOTP só).
import type { TestProject } from 'vitest/node';
import { criarCliente, esperar } from './cliente.ts';
import { config } from './config.ts';
import { type Ambiente, criarPacienteComConta, entrarEquipe } from './sessoes.ts';
import { janelasUsadas } from './totp.ts';

declare module 'vitest' {
  export interface ProvidedContext { ambiente: Ambiente }
}

export default async function preparar(project: TestProject) {
  if (config.antesUrl) {
    const r = await fetch(config.antesUrl, { method: 'POST' }).catch((e) => { throw new Error(`não consegui preparar o alvo em ${config.antesUrl}: ${e.message}`); });
    if (!r.ok) throw new Error(`preparação do alvo falhou: HTTP ${r.status}`);
  }
  let urlApi = config.urlApi;
  if (!urlApi) {
    const r = await fetch(`${config.diretorioUrl.replace(/\/$/, '')}/v1/organizacoes/${config.slug}`);
    if (!r.ok) throw new Error(`diretório não resolveu ${config.slug}: HTTP ${r.status}`);
    urlApi = (await r.json()).urlApi as string;
  }
  const api = criarCliente(urlApi);
  const pub = esperar(await api.chamar('GET', '/v1/publico/configuracao'), 200).body;
  const termosVersao = pub.autenticacao.termosVersao;
  const g = await entrarEquipe(api, { ...config.gestor }, termosVersao);
  const man = esperar(await api.chamar('GET', '/v1/sessao', { token: g.tokenAcesso }), 200).body;
  if (!man.usuario || !(await api.chamar('GET', '/v1/me', { token: g.tokenAcesso })).body.perfis.includes('GESTOR'))
    throw new Error('CONF_GESTOR_* precisa ser uma conta com perfil GESTOR');
  // Os testes de gestão usam um token no perfil GESTOR (o perfil vai no token; trocar emite outro).
  const tokenGestor = man.perfilAtivo === 'GESTOR' ? g.tokenAcesso
    : esperar(await api.chamar('PUT', '/v1/sessao/perfil-ativo', { token: g.tokenAcesso, body: { perfil: 'GESTOR' } }), 200).body.tokenAcesso;
  const gestor = { token: tokenGestor, renovacao: g.tokenRenovacao, usuarioId: man.usuario.id, email: config.gestor.email };
  const execucao = Date.now().toString(36);
  const pacienteA = await criarPacienteComConta(api, gestor, `conf.${execucao}.a@exemplo.com`, `Conformidade A ${execucao}`, termosVersao);
  const pacienteB = await criarPacienteComConta(api, gestor, `conf.${execucao}.b@exemplo.com`, `Conformidade B ${execucao}`, termosVersao);
  const ambiente: Ambiente = {
    urlApi, slug: pub.organizacao.slug, fuso: pub.organizacao.fuso, termosVersao, execucao,
    modulos: man.modulos.map((m: any) => m.id), tempoReal: man.capacidades.tempoReal,
    gestor, pacienteA, pacienteB, janelasTotp: janelasUsadas(),
  };
  project.provide('ambiente', ambiente);
}
