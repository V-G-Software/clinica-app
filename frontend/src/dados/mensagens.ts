// Mensagens de uma conversa: carrega as mais recentes, busca as novas a cada evento
// (`chat.mensagem.criada` invalida ['mensagens', id]) e as anteriores sob demanda.
// Envio otimista com idCliente (= Idempotency-Key): reenvio da mesma mensagem nunca duplica.
import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { Mensagem } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';

export interface Pendente { idCliente: string; tipo: 'TEXTO' | 'ANEXO'; texto: string | null; anexosIds: string[]; estado: 'enviando' | 'falhou'; criadoEm: number; erro?: string }

export function useMensagens(conversaId: Ref<string>, autorId: Ref<string | undefined>) {
  const lista = ref<Mensagem[]>([]);
  const pendentes = ref<Pendente[]>([]);
  const temAnteriores = ref(false);
  const carregandoAnteriores = ref(false);

  const mesclar = (novas: Mensagem[]) => {
    const porId = new Map(lista.value.map((m) => [m.id, m]));
    for (const m of novas) porId.set(m.id, m);
    lista.value = [...porId.values()].sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm) || a.id.localeCompare(b.id));
    const confirmados = new Set(novas.map((m) => m.idCliente).filter(Boolean));
    pendentes.value = pendentes.value.filter((p) => !confirmados.has(p.idCliente));
  };

  const consulta = useQuery({
    queryKey: ['mensagens', conversaId],
    queryFn: async () => {
      const ultima = lista.value.at(-1)?.id;
      const r = await ok(api().GET('/v1/conversas/{conversaId}/mensagens', { params: { path: { conversaId: conversaId.value }, query: ultima ? { depoisDe: ultima, limite: 100 } : { limite: 30 } } }));
      if (!ultima) temAnteriores.value = r.temMais;
      mesclar(r.itens);
      return lista.value.length;
    },
    staleTime: 0,
  });
  watch(conversaId, () => { lista.value = []; pendentes.value = []; });

  async function carregarAnteriores() {
    const primeira = lista.value[0]?.id;
    if (!primeira || carregandoAnteriores.value) return;
    carregandoAnteriores.value = true;
    try {
      const r = await ok(api().GET('/v1/conversas/{conversaId}/mensagens', { params: { path: { conversaId: conversaId.value }, query: { antesDe: primeira, limite: 30 } } }));
      temAnteriores.value = r.temMais;
      mesclar(r.itens);
    } finally { carregandoAnteriores.value = false; }
  }

  async function tentar(p: Pendente) {
    p.estado = 'enviando'; p.erro = undefined;
    try {
      const m = await ok(api().POST('/v1/conversas/{conversaId}/mensagens', {
        params: { path: { conversaId: conversaId.value }, header: { 'Idempotency-Key': p.idCliente } },
        body: { idCliente: p.idCliente, tipo: p.tipo, texto: p.texto, anexosIds: p.anexosIds },
      }));
      mesclar([m]);
    } catch (e) {
      p.estado = 'falhou';
      p.erro = e instanceof ErroApi ? e.codigo : 'REDE';
      // 4xx definitivo (ex.: conversa arquivada) não volta para a fila automática.
      if (e instanceof ErroApi && e.status >= 400 && e.status < 500) p.erro = e.codigo;
    }
  }
  function enviar(texto: string | null, anexosIds: string[] = []) {
    const p: Pendente = { idCliente: crypto.randomUUID(), tipo: anexosIds.length ? 'ANEXO' : 'TEXTO', texto: texto?.trim() || null, anexosIds, estado: 'enviando', criadoEm: Date.now() };
    pendentes.value.push(p);
    const reativo = pendentes.value.at(-1)!;
    if (!navigator.onLine) { reativo.estado = 'falhou'; reativo.erro = 'REDE'; return; }
    void tentar(reativo);
  }
  /** Ao reconectar, reenvia na ordem, com a mesma chave (sem duplicar). */
  async function reenviarFila() {
    for (const p of pendentes.value.filter((x) => x.estado === 'falhou' && x.erro === 'REDE')) await tentar(p);
  }
  const aoVoltarRede = () => void reenviarFila();
  window.addEventListener('online', aoVoltarRede);
  onUnmounted(() => window.removeEventListener('online', aoVoltarRede));

  const minhas = (m: Mensagem) => m.autor?.usuarioId === autorId.value;
  return { lista, pendentes, temAnteriores, carregandoAnteriores, carregando: computed(() => consulta.isPending.value), erro: consulta.error, carregarAnteriores, enviar, tentar, reenviarFila, minhas };
}
