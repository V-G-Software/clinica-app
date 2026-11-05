// Sessão: token SÓ em memória (nunca em storage), manifesto do perfil ativo e renovação.
import { defineStore } from 'pinia';
import type { Manifesto, Perfil } from '@clinica/contrato-tipos';
import { api, ok, renovarSessao } from '@/api';
import { ErroApi } from '@/api/erros';
import type { TokenRenovado } from '@/api/renovacao';
import { useAppStore } from '@/app/store';
import { montarMenu } from './navegacao';

let temporizador: ReturnType<typeof setTimeout> | undefined;

export const useSessaoStore = defineStore('sessao', {
  state: () => ({
    token: null as string | null,
    expiraEm: null as string | null,
    manifesto: null as Manifesto | null,
    etagManifesto: null as string | null,
    motivoSaida: null as string | null,
  }),
  getters: {
    logado: (s) => !!s.token && !!s.manifesto,
    perfil: (s) => s.manifesto?.perfilAtivo as Perfil | undefined,
    ehPaciente: (s) => s.manifesto?.perfilAtivo === 'PACIENTE',
    termos: (s) => s.manifesto?.termos,
    menu: (s) => (s.manifesto ? montarMenu(s.manifesto) : { principal: [], secundario: [] }),
    modulos: (s) => new Set((s.manifesto?.modulos ?? []).map((m) => m.id as string)),
    pode: (s) => (permissao: string) => (s.manifesto?.permissoes as string[] | undefined)?.includes(permissao) ?? false,
  },
  actions: {
    definirToken(t: TokenRenovado) {
      this.token = t.tokenAcesso;
      this.expiraEm = t.expiraEm;
      this.agendarRenovacao();
    },
    /** Renova ~1 min antes de expirar, no relógio do backend. O 401 também renova (rede de segurança). */
    agendarRenovacao() {
      clearTimeout(temporizador);
      if (!this.expiraEm) return;
      const app = useAppStore();
      const restante = Date.parse(this.expiraEm) - app.agoraServidor() - 60_000;
      temporizador = setTimeout(() => void this.renovar(), Math.max(5_000, Math.min(restante, 2_147_000_000)));
    },
    async renovar() {
      const t = await renovarSessao().catch(() => null);
      if (t) this.definirToken(t);
      return t;
    },
    /** Ao abrir o app: tenta restaurar a sessão pelo cookie de renovação. */
    async restaurar(): Promise<boolean> {
      const t = await this.renovar();
      if (!t) return false;
      try { await this.carregarManifesto(); return true; } catch { this.limpar(); return false; }
    },
    async concluirLogin(t: TokenRenovado) {
      this.motivoSaida = null;
      this.definirToken(t);
      await this.carregarManifesto();
    },
    async carregarManifesto() {
      const { data, response, error } = await api().GET('/v1/sessao', { params: { header: this.etagManifesto && this.manifesto ? { 'If-None-Match': this.etagManifesto } : {} } });
      if (response.status === 304) return this.manifesto!;
      if (!response.ok) throw new ErroApi(response.status, (error as any)?.codigo ?? 'DESCONHECIDO', response.headers.get('X-Request-Id'));
      this.manifesto = data!;
      this.etagManifesto = response.headers.get('ETag');
      return data!;
    },
    async trocarPerfil(perfil: Perfil) {
      const t = await ok(api().PUT('/v1/sessao/perfil-ativo', { body: { perfil } }));
      this.definirToken(t);
      this.etagManifesto = null;
      await this.carregarManifesto();
    },
    async sair(todas = false) {
      await ok(api().POST('/v1/auth/sair', { body: { todas } })).catch(() => undefined);
      this.limpar();
    },
    /** Sessão perdida (revogada, expirada sem renovação ou `sessao.encerrada`). */
    encerrar(motivo: string) {
      this.limpar();
      this.motivoSaida = motivo;
    },
    limpar() {
      clearTimeout(temporizador);
      this.token = null; this.expiraEm = null; this.manifesto = null; this.etagManifesto = null;
    },
  },
});
