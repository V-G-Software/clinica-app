// Descobre a organização (3.1): convite → ?org= (só em DEV) → host.
export type Descoberta =
  | { tipo: 'slug'; slug: string; origem: 'convite' | 'parametro' | 'subdominio' }
  | { tipo: 'dominio'; dominio: string };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function descobrirOrganizacao(url: URL, opcoes: { dev: boolean; dominioPrincipal: string }): Descoberta | null {
  const org = url.searchParams.get('org');
  if (url.pathname.startsWith('/convite/') && org && SLUG.test(org)) return { tipo: 'slug', slug: org, origem: 'convite' };
  if (opcoes.dev && org && SLUG.test(org)) return { tipo: 'slug', slug: org, origem: 'parametro' };
  const host = url.hostname.toLowerCase();
  const sufixo = `.${opcoes.dominioPrincipal.toLowerCase()}`;
  if (host.endsWith(sufixo)) {
    const sub = host.slice(0, -sufixo.length);
    if (SLUG.test(sub)) return { tipo: 'slug', slug: sub, origem: 'subdominio' };
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === opcoes.dominioPrincipal) return null;
  return { tipo: 'dominio', dominio: host };
}
