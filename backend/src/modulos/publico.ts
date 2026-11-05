// Configuração pública (6), saúde e convite público.
import { createHash } from 'node:crypto';
import { versaoContrato } from '@clinica/contrato-validador';
import { config } from '../config.ts';
import { ok, type Handler } from '../http.ts';
import type { Org } from '../nucleo.ts';
import { convitePublico, obterConvite } from './auth.ts';

export function configuracaoPublica(org: Org) {
  const c = org.configuracao;
  return {
    contrato: { versao: versaoContrato }, status: org.status, mensagemStatus: org.mensagemStatus ?? null,
    frontend: { versaoMinima: config.versaoMinimaFrontend },
    organizacao: { slug: org.slug, nome: org.nome, fuso: org.fuso, locale: org.locale },
    tema: c.tema, pwa: c.pwa, autenticacao: c.autenticacao, textos: c.textos, links: c.links,
  };
}
export const handlersPublico: Record<string, Handler> = {
  publicoObterConfiguracao: async (q) => {
    const corpo = configuracaoPublica(q.org);
    const tag = `"cfg-${createHash('sha1').update(JSON.stringify(corpo)).digest('hex').slice(0, 16)}"`;
    if (q.headers['if-none-match'] === tag) return { status: 304, headers: { ETag: tag } };
    return ok(corpo, { ETag: tag, 'Cache-Control': 'max-age=300' });
  },
  publicoObterSaude: async () => ok({ status: 'OK', contrato: { versao: versaoContrato }, agora: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }),
  publicoObterConvite: async (q) => ok(convitePublico(q.org, await obterConvite(q.tx, q.org, q.params.token))),
};
