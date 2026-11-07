<script setup lang="ts">
// Perfil: dados, tema/densidade (PATCH /v1/me com If-Match), notificações por tipo, push,
// troca de perfil, sair, sair de todos e excluir conta (paciente).
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { Perfil } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { aplicarModo, type ModoTema } from '@/app/tema';
import { useSessaoStore } from '@/sessao/store';
import { ativarPush, desativarPush, estadoPush, type EstadoPush } from '@/pwa/push';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';
import Aviso from '@/ds/Aviso.vue';

const { t } = useI18n();
const app = useAppStore();
const sessao = useSessaoStore();
const router = useRouter();
const qc = useQueryClient();
const m = computed(() => sessao.manifesto!);

// Preferências (If-Match com o ETag de GET /v1/me).
async function salvarPreferencias(p: Record<string, string>) {
  const { data, response } = await api().GET('/v1/me', {});
  const etag = response.headers.get('ETag') ?? '*';
  await ok(api().PATCH('/v1/me', { params: { header: { 'If-Match': etag } }, body: { preferencias: { ...data!.preferencias, ...p } as never } }));
  await sessao.carregarManifesto();
  aplicarModo(sessao.manifesto?.usuario.preferencias.tema as ModoTema, app.config!.tema.modoPadrao as ModoTema);
}

const NOMES: Record<string, string> = { CHAT_MENSAGEM: 'Mensagens', CHECKIN_DISPONIVEL: 'Check-in disponível', CHECKIN_LEMBRETE: 'Lembretes de check-in', ALERTA_CRIADO: 'Alertas', ACOMPANHAMENTO_INICIADO: 'Início de acompanhamento', ACOMPANHAMENTO_CONCLUIDO: 'Fim de acompanhamento', CONVITE_ACEITO: 'Convites aceitos', SISTEMA: 'Avisos do sistema', AGENDAMENTO_CRIADO: 'Agendamentos', AGENDAMENTO_ALTERADO: 'Mudanças em agendamentos', AGENDAMENTO_LEMBRETE: 'Lembretes de agendamento', EXAME_PEDIDO: 'Pedidos de exame', EXAME_RESULTADO: 'Resultados de exame recebidos', EXAME_REVISADO: 'Resultados de exame revisados' };
const prefs = useQuery({ queryKey: ['preferencias-notificacao'], queryFn: () => ok(api().GET('/v1/notificacoes/preferencias', {})) });
const salvarPrefs = useMutation({
  mutationFn: (itens: NonNullable<typeof prefs.data.value>['itens']) => ok(api().PUT('/v1/notificacoes/preferencias', { body: { itens } })),
  onSuccess: (d) => qc.setQueryData(['preferencias-notificacao'], d),
});
function alternar(tipo: string, canal: 'push' | 'email') {
  const itens = prefs.data.value!.itens.map((i) => (i.tipo === tipo ? { ...i, [canal]: !i[canal] } : i));
  salvarPrefs.mutate(itens);
}

const push = ref<EstadoPush>('indisponivel');
const erroPush = ref<string | null>(null);
onMounted(async () => { push.value = await estadoPush(m.value.usuario.id, m.value.capacidades.push.modo).catch(() => 'indisponivel' as const); });
async function ativar() {
  erroPush.value = null;
  try { push.value = await ativarPush(m.value.usuario.id, m.value.capacidades.push.chavePublicaVapid ?? ''); }
  catch (e) { erroPush.value = e instanceof ErroApi ? t(`erros.${e.codigo}`) : 'Não foi possível ativar as notificações neste aparelho.'; }
}
async function desativar() { await desativarPush(m.value.usuario.id); push.value = 'inativo'; }

async function trocar(p: string) { await sessao.trocarPerfil(p as Perfil); await router.replace('/'); }
async function sair(todas: boolean) { await sessao.sair(todas); await router.replace('/entrar'); }
const confirmandoExclusao = ref(false);
const resultadoExclusao = ref<{ mensagem: string; dadosRetidos: string[] } | null>(null);
async function excluir() {
  resultadoExclusao.value = await ok(api().POST('/v1/me/exclusao', {}));
  sessao.limpar();
}
</script>
<template>
  <div v-if="resultadoExclusao" class="flex flex-col gap-3">
    <h1 class="text-2xl font-bold">Acesso removido</h1>
    <p>{{ resultadoExclusao.mensagem }}</p>
    <ul class="list-disc pl-6"><li v-for="d in resultadoExclusao.dadosRetidos" :key="d">{{ d }}</li></ul>
  </div>
  <div v-else-if="sessao.manifesto" class="mx-auto flex max-w-xl flex-col gap-4">
    <header>
      <h1 class="text-2xl font-bold">{{ m.usuario.nomeExibicao }}</h1>
      <p class="text-zinc-600 dark:text-zinc-300">{{ m.usuario.email }}</p>
    </header>

    <Cartao v-if="m.perfisDisponiveis.length > 1">
      <h2 class="mb-2 font-bold">{{ t('nav.trocarPerfil') }}</h2>
      <div class="flex flex-wrap gap-2">
        <Botao v-for="p in m.perfisDisponiveis" :key="p.id" :variante="p.id === sessao.perfil ? 'primario' : 'secundario'" :desabilitado="p.id === sessao.perfil" @click="trocar(p.id)">{{ p.rotulo }}</Botao>
      </div>
    </Cartao>

    <Cartao>
      <h2 class="mb-2 font-bold">Aparência</h2>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Tema">
        <Botao v-for="[v, r] in [['SISTEMA', 'Automático'], ['CLARO', 'Claro'], ['ESCURO', 'Escuro']]" :key="v" :variante="(m.usuario.preferencias.tema ?? 'SISTEMA') === v ? 'primario' : 'secundario'" @click="salvarPreferencias({ tema: v })">{{ r }}</Botao>
      </div>
      <div v-if="!sessao.ehPaciente" class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Densidade">
        <Botao v-for="[v, r] in [['CONFORTAVEL', 'Confortável'], ['COMPACTA', 'Compacta']]" :key="v" :variante="(m.usuario.preferencias.densidade ?? 'CONFORTAVEL') === v ? 'primario' : 'secundario'" @click="salvarPreferencias({ densidade: v })">{{ r }}</Botao>
      </div>
    </Cartao>

    <Cartao>
      <h2 class="mb-2 font-bold">Notificações neste aparelho</h2>
      <p v-if="push === 'ativo'" class="mb-2">Ativadas. <Botao variante="fantasma" @click="desativar">Desativar</Botao></p>
      <template v-else-if="push === 'inativo'"><p class="mb-2 text-sm">Receba um aviso quando a equipe responder ou quando houver um check-in.</p><Botao @click="ativar">Ativar notificações</Botao></template>
      <Aviso v-else-if="push === 'precisa-instalar'">No iPhone, as notificações só funcionam com o app na Tela de Início. <RouterLink to="/bem-vindo" class="underline">Ver como instalar</RouterLink></Aviso>
      <Aviso v-else-if="push === 'negado'" tipo="atencao">As notificações estão bloqueadas nas configurações do navegador. Enquanto isso, avisamos por e-mail.</Aviso>
      <p v-else class="text-sm text-zinc-600">Notificações no aparelho não estão disponíveis aqui. Avisamos por e-mail.</p>
      <p v-if="erroPush" class="mt-2 text-sm text-erro" role="alert">{{ erroPush }}</p>
      <table v-if="prefs.data.value" class="mt-4 w-full text-sm">
        <thead><tr class="text-left"><th class="py-1">Tipo</th><th>App</th><th>E-mail</th></tr></thead>
        <tbody>
          <tr v-for="i in prefs.data.value.itens" :key="i.tipo" class="border-t border-zinc-200 dark:border-zinc-700">
            <td class="py-2">{{ NOMES[i.tipo] ?? i.tipo }}</td>
            <td><input type="checkbox" class="size-5" :checked="i.push" :aria-label="`${NOMES[i.tipo] ?? i.tipo}: no app`" @change="alternar(i.tipo, 'push')" /></td>
            <td><input type="checkbox" class="size-5" :checked="i.email" :aria-label="`${NOMES[i.tipo] ?? i.tipo}: por e-mail`" @change="alternar(i.tipo, 'email')" /></td>
          </tr>
        </tbody>
      </table>
    </Cartao>

    <Botao variante="secundario" @click="sair(false)">{{ t('app.sair') }}</Botao>
    <Botao variante="fantasma" @click="sair(true)">Sair de todos os aparelhos</Botao>
    <template v-if="sessao.ehPaciente">
      <Botao v-if="!confirmandoExclusao" variante="fantasma" @click="confirmandoExclusao = true">Excluir minha conta</Botao>
      <Aviso v-else tipo="atencao">
        Você perde o acesso ao app. A {{ app.nome }} continua obrigada por lei a guardar os registros do seu atendimento.
        <div class="mt-2 flex gap-2"><Botao variante="secundario" @click="confirmandoExclusao = false">Cancelar</Botao><Botao @click="excluir">Excluir conta</Botao></div>
      </Aviso>
    </template>
  </div>
</template>
