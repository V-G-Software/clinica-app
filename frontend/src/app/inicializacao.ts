// As três camadas (seção 3): diretório → configuração pública → sessão.
import type { ConfiguracaoPublica, OrganizacaoDiretorio } from '@clinica/contrato-tipos';
import { configurarApi } from '@/api';
import { definirIdioma } from '@/i18n';
import { useSessaoStore } from '@/sessao/store';
import { descobrirOrganizacao } from './descoberta';
import { useAppStore } from './store';
import { aplicarMarca, aplicarModo, type ModoTema } from './tema';
import { compararVersoes, CONTRATO_MAIOR_SUPORTADO, versaoMaior } from './versao';

const DIRETORIO = (import.meta.env.VITE_DIRETORIO_URL ?? '/diretorio').replace(/\/$/, '');
const CACHE = 'org:';

const CHAVE_DEV = 'dev:org';
/** Em desenvolvimento, lembra o último ?org= para o slug não se perder ao navegar. */
function urlComOrgDev(): URL {
  const url = new URL(location.href);
  if (!import.meta.env.DEV) return url;
  try {
    const org = url.searchParams.get('org');
    if (org) localStorage.setItem(CHAVE_DEV, org);
    else { const salvo = localStorage.getItem(CHAVE_DEV); if (salvo) url.searchParams.set('org', salvo); }
  } catch { /* armazenamento indisponível */ }
  return url;
}

async function resolverOrganizacao(): Promise<OrganizacaoDiretorio | 'escolher' | null> {
  const d = descobrirOrganizacao(urlComOrgDev(), { dev: import.meta.env.DEV, dominioPrincipal: import.meta.env.VITE_DOMINIO ?? 'localhost' });
  if (!d) return import.meta.env.DEV ? 'escolher' : null;
  const url = d.tipo === 'slug' ? `${DIRETORIO}/v1/organizacoes/${d.slug}` : `${DIRETORIO}/v1/organizacoes?dominio=${encodeURIComponent(d.dominio)}`;
  const chave = CACHE + (d.tipo === 'slug' ? d.slug : d.dominio);
  try {
    const r = await fetch(url);
    if (r.status === 404) { lerOuApagar(chave, true); return null; }
    if (!r.ok) throw new Error(String(r.status));
    const org = (await r.json()) as OrganizacaoDiretorio;
    try { localStorage.setItem(chave, JSON.stringify(org)); } catch { /* armazenamento indisponível */ }
    return org;
  } catch {
    // Diretório fora do ar: usa a última resolução conhecida (não é dado pessoal).
    const salvo = lerOuApagar(chave, false);
    if (salvo) return salvo;
    throw new Error('diretório indisponível');
  }
}
function lerOuApagar(chave: string, apagar: boolean): OrganizacaoDiretorio | null {
  try {
    if (apagar) { localStorage.removeItem(chave); return null; }
    const v = localStorage.getItem(chave);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

let prontidao: Promise<void> | null = null;
/** A guarda de rotas espera a inicialização: a sessão precisa ser restaurada antes de decidir. */
export const aguardarInicializacao = () => prontidao ?? iniciar();
export function iniciar() { prontidao = inicializar(); return prontidao; }

async function inicializar() {
  const app = useAppStore();
  const sessao = useSessaoStore();
  app.estado = 'carregando';
  try {
    const org = await resolverOrganizacao();
    if (org === 'escolher') { app.estado = 'escolher-organizacao'; return; }
    if (!org) { app.estado = 'nao-encontrada'; return; }
    app.organizacao = org;
    if (versaoMaior(org.contratoVersao) > CONTRATO_MAIOR_SUPORTADO) { app.estado = 'atualizar'; return; }
    if (org.status === 'SUSPENSA') { app.estado = 'suspensa'; return; }

    const r = await fetch(`${org.urlApi}/v1/publico/configuracao`);
    if (!r.ok) throw new Error(`configuração: HTTP ${r.status}`);
    const cfg = (await r.json()) as ConfiguracaoPublica;
    app.config = cfg;
    aplicarMarca(cfg, { dev: import.meta.env.DEV });
    aplicarModo(undefined, cfg.tema.modoPadrao as ModoTema);
    definirIdioma(cfg.organizacao.locale);
    if (compararVersoes(__VERSAO_APP__, cfg.frontend.versaoMinima) < 0) { app.estado = 'atualizar'; return; }
    if (cfg.status === 'MANUTENCAO' || org.status === 'MANUTENCAO') { app.estado = 'manutencao'; app.mensagem = cfg.mensagemStatus; return; }
    if (cfg.status === 'SUSPENSA') { app.estado = 'suspensa'; return; }

    const saude = await fetch(`${org.urlApi}/v1/publico/saude`).then((x) => x.json()).catch(() => null);
    if (saude?.agora) app.desvioRelogioMs = Date.parse(saude.agora) - Date.now();

    configurarApi(org.urlApi, org.slug, {
      token: () => sessao.token,
      aoRenovar: (t) => sessao.definirToken(t),
      aoPerderSessao: (codigo) => sessao.encerrar(codigo),
    });
    await sessao.restaurar();
    if (sessao.manifesto) aplicarModo(sessao.manifesto.usuario.preferencias.tema as ModoTema | undefined, cfg.tema.modoPadrao as ModoTema);
    app.estado = 'pronto';
  } catch (e) {
    console.error(e);
    app.estado = 'erro';
  }
}
