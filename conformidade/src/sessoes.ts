// Login genérico por etapas (5.2) e criação de pacientes de teste via convite.
import { randomUUID } from 'node:crypto';
import { type Cliente, esperar } from './cliente.ts';
import { config } from './config.ts';
import { proximoCodigo, totp } from './totp.ts';

export interface Sessao { token: string; renovacao?: string; usuarioId: string; email: string; pacienteId?: string; perfis?: string[] }
export interface Ambiente {
  urlApi: string; slug: string; fuso: string; termosVersao: string; execucao: string;
  modulos: string[]; tempoReal: { modo: string; intervaloPollingSegundos: number };
  gestor: Sessao; pacienteA: Sessao; pacienteB: Sessao; janelasTotp: Record<string, number>;
}

export interface Credenciais { email: string; senha?: string; totp?: string; novaSenha?: string }
/** Percorre as etapas até CONCLUIDO. Devolve as etapas vistas e o token (modo NATIVO). */
export async function percorrerEtapas(api: Cliente, primeira: any, cred: Credenciais, termosVersao: string) {
  const vistas: string[] = [];
  let r = primeira;
  let codigosRecuperacao: string[] | undefined;
  for (let i = 0; i < 8; i++) {
    vistas.push(r.etapa);
    const d = r.desafioId;
    switch (r.etapa) {
      case 'CONCLUIDO':
        return { vistas, tokenAcesso: r.tokenAcesso as string, tokenRenovacao: r.tokenRenovacao as string | undefined, expiraEm: r.expiraEm, codigosRecuperacao };
      case 'MFA': {
        if (!cred.totp) throw new Error('etapa MFA sem segredo TOTP configurado');
        let resp = await api.chamar('POST', '/v1/auth/mfa/verificar', { body: { desafioId: d, codigo: await proximoCodigo(cred.totp) } });
        // Backends que recusam reuso de TOTP: se outro cliente já usou esta janela, espera a próxima (uma vez).
        if (resp.status !== 200 && resp.body?.codigo === 'CODIGO_INVALIDO') resp = await api.chamar('POST', '/v1/auth/mfa/verificar', { body: { desafioId: d, codigo: await proximoCodigo(cred.totp) } });
        r = esperar(resp, 200).body;
        break;
      }
      case 'CONFIGURAR_MFA': {
        const ini = esperar(await api.chamar('POST', '/v1/auth/mfa/totp/iniciar', { body: { desafioId: d } }), 200).body;
        cred.totp = ini.segredo;
        r = esperar(await api.chamar('POST', '/v1/auth/mfa/totp/confirmar', { body: { desafioId: d, codigo: await proximoCodigo(ini.segredo) } }), 200).body;
        codigosRecuperacao = r.codigosRecuperacao;
        break;
      }
      case 'TROCAR_SENHA':
        cred.novaSenha = `Conf${randomUUID().slice(0, 8)}x9`;
        r = esperar(await api.chamar('POST', '/v1/auth/senha/trocar', { body: { desafioId: d, novaSenha: cred.novaSenha } }), 200).body;
        break;
      case 'ACEITAR_TERMOS':
        r = esperar(await api.chamar('POST', '/v1/auth/termos/aceitar', { body: { desafioId: d, termosVersao: r.termos?.versao ?? termosVersao } }), 200).body;
        break;
      case 'CODIGO_ENVIADO':
        r = esperar(await api.chamar('POST', '/v1/auth/codigo/verificar', { body: { email: cred.email, codigo: config.codigoEmail, desafioId: d } }), 200).body;
        break;
      default:
        throw new Error(`etapa desconhecida: ${r.etapa}`);
    }
  }
  throw new Error(`login não concluiu após etapas ${vistas.join(' → ')}`);
}

export async function entrarEquipe(api: Cliente, cred: Credenciais, termosVersao: string) {
  const r = esperar(await api.chamar('POST', '/v1/auth/entrar', { body: { email: cred.email, senha: cred.senha } }), 200);
  return percorrerEtapas(api, r.body, cred, termosVersao);
}
export async function entrarPaciente(api: Cliente, email: string, termosVersao: string) {
  esperar(await api.chamar('POST', '/v1/auth/codigo/solicitar', { body: { email } }), 202);
  const r = esperar(await api.chamar('POST', '/v1/auth/codigo/verificar', { body: { email, codigo: config.codigoEmail } }), 200);
  return percorrerEtapas(api, r.body, { email }, termosVersao);
}

/** Respostas mínimas válidas para um formulário (campos obrigatórios visíveis). */
export function respostasMinimas(formulario: any, extras: Record<string, unknown> = {}, fotos: string[] = []) {
  const r: Record<string, unknown> = {};
  for (const c of formulario.campos) {
    if (c.id in extras) { r[c.id] = extras[c.id]; continue; }
    if (!c.obrigatorio || c.tipo === 'INFORMACAO') continue;
    if (c.visivelSe) {
      const v = (r as any)[c.visivelSe.campo];
      const visivel = c.visivelSe.operador === 'IGUAL' ? v === c.visivelSe.valor : c.visivelSe.operador === 'DIFERENTE' ? v !== c.visivelSe.valor : true;
      if (!visivel) continue;
    }
    r[c.id] = { TEXTO: 'ok', TEXTO_LONGO: 'ok', NUMERO: c.min ?? 0, ESCALA: c.min ?? 0, SIM_NAO: false, ESCOLHA_UNICA: c.opcoes?.[0]?.valor,
      ESCOLHA_MULTIPLA: [c.opcoes?.[0]?.valor], DATA: '2026-01-01', HORA: '09:00', FOTO: fotos }[c.tipo as string];
    if (c.tipo === 'FOTO' && !fotos.length) throw new Error('formulário exige foto: envie um arquivo antes');
  }
  return r;
}

/** Cadastra um paciente adequado à organização (pessoa ou animal, campos adicionais) e o convida. */
export async function criarPacienteComConta(api: Cliente, gestor: Sessao, email: string, nome: string, termosVersao: string): Promise<Sessao> {
  const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
  const cfg = man.modulos.find((m: any) => m.id === 'pacientes')?.config;
  const animal = cfg.relacoesPermitidas.every((x: string) => x === 'ANIMAL');
  let camposAdicionais = {};
  if (cfg.formularioCadastroId) {
    const f = esperar(await api.chamar('GET', `/v1/formularios/${cfg.formularioCadastroId}`, { token: gestor.token }), 200).body;
    camposAdicionais = respostasMinimas(f);
  }
  const corpo = animal
    ? { tipo: 'ANIMAL', nome, contato: { email: null, celular: null }, camposAdicionais, responsaveis: [{ nome: `Tutor de ${nome}`, contato: { email, celular: null } }] }
    : { tipo: 'PESSOA', nome, contato: { email, celular: null }, camposAdicionais };
  const pac = esperar(await api.chamar('POST', '/v1/pacientes', { token: gestor.token, body: corpo, idempotencia: true }), 201).body;
  const conv = esperar(await api.chamar('POST', `/v1/pacientes/${pac.id}/convites`, { token: gestor.token, body: { email }, idempotencia: true }), 201).body;
  const r = esperar(await api.chamar('POST', `/v1/auth/convites/${conv.token}/aceitar`, { body: { email, termosVersao } }), 200);
  const fim = await percorrerEtapas(api, r.body, { email }, termosVersao);
  const me = esperar(await api.chamar('GET', '/v1/me', { token: fim.tokenAcesso }), 200).body;
  return { token: fim.tokenAcesso, renovacao: fim.tokenRenovacao, usuarioId: me.id, email, pacienteId: pac.id, perfis: me.perfis };
}

export const totpAtual = (segredo: string) => totp(segredo, Math.floor(Date.now() / 30_000));
