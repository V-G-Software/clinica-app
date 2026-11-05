<script setup lang="ts">
// Detalhe do paciente: dados (edição com If-Match), acesso ao app, convite com QR,
// acompanhamentos, conversa e inativação. Botões só pelo `acoesPermitidas`.
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import QRCode from 'qrcode';
import { Activity, MessageCircle, Pencil, QrCode } from 'lucide-vue-next';
import type { PacienteEntrada } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { comEtag } from '@/dados/etag';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import { formatarData, formatarDataHora } from '@/i18n/datas';
import { formatarTelefone } from '@/i18n/telefone';
import { capitalizar } from '@/i18n/termos';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';
import Aviso from '@/ds/Aviso.vue';
import Dialogo from '@/ds/Dialogo.vue';
import Conflito from '@/ds/Conflito.vue';
import FormPaciente from './FormPaciente.vue';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const id = computed(() => String(rota.params.pacienteId));
const q = useQuery({ queryKey: ['paciente', id], queryFn: () => comEtag(api().GET('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: id.value } } })) });
const p = computed(() => q.data.value?.dado);
const acoes = computed(() => new Set(p.value?.acoesPermitidas ?? []));
const acps = useQuery({ queryKey: ['acompanhamentos', { pacienteId: id }], queryFn: () => ok(api().GET('/v1/acompanhamentos', { params: { query: { pacienteId: id.value, limite: 20 } } })) });

// Edição (If-Match).
const editando = ref(false);
const conflito = ref(false);
const errosServidor = ref<Record<string, string>>({});
const edicao = useMutation({
  mutationFn: (corpo: Partial<PacienteEntrada> & { status?: 'ATIVO' | 'INATIVO' }) => comEtag(api().PATCH('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: id.value }, header: { 'If-Match': q.data.value?.etag ?? '' } }, body: corpo as never })),
  onSuccess: (r) => { qc.setQueryData(['paciente', id], r); void qc.invalidateQueries({ queryKey: ['pacientes'] }); editando.value = false; conflito.value = false; errosServidor.value = {}; },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; if (e instanceof ErroApi && e.status === 422) errosServidor.value = e.porCampo(); },
});
async function recarregar() { conflito.value = false; edicao.reset(); await q.refetch(); }
function salvar(corpo: PacienteEntrada) { const { tipo, ...resto } = corpo; void tipo; edicao.mutate(resto); }

// Convite com QR (mostrado na consulta).
const convite = ref<{ link: string; qr: string; expiraEm: string; emailEnviado: boolean } | null>(null);
const chaveConvite = criarChave();
const convidar = useMutation({
  mutationFn: (enviarEmail: boolean) => ok(api().POST('/v1/pacientes/{pacienteId}/convites', { params: { path: { pacienteId: id.value }, header: { 'Idempotency-Key': chaveConvite.obter() } }, body: { enviarEmail } })),
  onSuccess: async (c) => { chaveConvite.concluir(); convite.value = { link: c.link, qr: await QRCode.toDataURL(c.conteudoQr, { margin: 1, width: 260 }), expiraEm: c.expiraEm, emailEnviado: c.emailEnviado }; void q.refetch(); },
});
const copiado = ref(false);
async function copiar() { await navigator.clipboard?.writeText(convite.value!.link); copiado.value = true; }

// Conversa: "clica no paciente e cai na conversa dele" (RN-CHA-001).
const chaveConversa = criarChave();
const abrirConversa = useMutation({
  mutationFn: () => ok(api().POST('/v1/conversas', { params: { header: { 'Idempotency-Key': chaveConversa.obter() } }, body: { pacienteId: id.value } })),
  onSuccess: (c) => { chaveConversa.concluir(); void router.push(`/conversas/${c.id}`); },
});
const ACESSO: Record<string, string> = { ATIVO: 'Usa o app', CONVITE_PENDENTE: 'Convite enviado, ainda não aceito', SEM_ACESSO: 'Ainda não usa o app' };
const AVISO: Record<string, string> = { PUSH: 'Recebe avisos no celular', EMAIL: 'Recebe avisos por e-mail (sem notificação no celular)', NENHUMA: 'Não recebe avisos' };
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-4">
    <p v-if="q.isPending.value">{{ t('app.carregando') }}</p>
    <Aviso v-else-if="q.error.value" tipo="erro">{{ msg(q.error.value)?.texto }}</Aviso>
    <template v-else-if="p">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">{{ p.nomeSocial ?? p.nome }}</h1>
          <p v-if="p.nomeSocial" class="text-sm text-secundario">Nome civil: {{ p.nome }}</p>
          <p v-if="p.status === 'INATIVO'" class="font-semibold text-atencao">Inativo</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Botao v-if="acoes.has('ABRIR_CONVERSA')" variante="secundario" :carregando="abrirConversa.isPending.value" @click="abrirConversa.mutate()"><MessageCircle class="size-5" aria-hidden="true" /> {{ capitalizar(termo('conversa').singular) }}</Botao>
          <RouterLink v-if="acoes.has('INICIAR_ACOMPANHAMENTO')" :to="`/acompanhamentos/novo?pacienteId=${p.id}`"><Botao><Activity class="size-5" aria-hidden="true" /> Iniciar {{ termo('acompanhamento').singular }}</Botao></RouterLink>
        </div>
      </header>

      <Cartao>
        <div class="mb-2 flex items-center justify-between"><h2 class="font-bold">Dados</h2>
          <Botao v-if="acoes.has('EDITAR')" variante="fantasma" @click="editando = true"><Pencil class="size-4" aria-hidden="true" /> Editar</Botao></div>
        <dl class="grid gap-2 sm:grid-cols-2">
          <div v-if="p.dataNascimento"><dt class="text-sm text-secundario">Nascimento</dt><dd>{{ formatarData(p.dataNascimento, app.locale) }}</dd></div>
          <div v-if="p.contato.email"><dt class="text-sm text-secundario">E-mail</dt><dd>{{ p.contato.email }}</dd></div>
          <div v-if="p.contato.celular"><dt class="text-sm text-secundario">Celular</dt><dd><a :href="`tel:${p.contato.celular}`" class="text-acao underline">{{ formatarTelefone(p.contato.celular) }}</a></dd></div>
          <div v-for="r in p.responsaveis" :key="r.nome"><dt class="text-sm text-secundario">{{ capitalizar(termo('responsavel').singular) }}{{ r.parentesco ? ` (${r.parentesco})` : '' }}</dt><dd>{{ r.nome }} · {{ r.contato.email ?? formatarTelefone(r.contato.celular) }}</dd></div>
          <div v-for="(v, k) in p.camposAdicionais as Record<string, unknown>" :key="k"><dt class="text-sm text-secundario">{{ k }}</dt><dd>{{ v }}</dd></div>
        </dl>
      </Cartao>

      <Cartao>
        <h2 class="mb-1 font-bold">Acesso ao app</h2>
        <p>{{ ACESSO[p.acessoApp.status] ?? p.acessoApp.status }}<span v-if="p.acessoApp.ultimoAcessoEm" class="text-sm text-secundario"> · último acesso {{ formatarDataHora(p.acessoApp.ultimoAcessoEm, app.fuso, app.locale) }}</span></p>
        <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ AVISO[p.acessoApp.notificacoes] }}</p>
        <div v-if="acoes.has('CONVIDAR') && p.acessoApp.status !== 'ATIVO'" class="mt-3 flex flex-wrap gap-2">
          <Botao :carregando="convidar.isPending.value" @click="convidar.mutate(false)"><QrCode class="size-5" aria-hidden="true" /> Mostrar QR code</Botao>
          <Botao variante="secundario" :carregando="convidar.isPending.value" @click="convidar.mutate(true)">Enviar convite por e-mail</Botao>
        </div>
        <Aviso v-if="convidar.error.value" tipo="erro" class="mt-2">{{ msg(convidar.error.value)?.texto }}</Aviso>
      </Cartao>

      <Cartao>
        <h2 class="mb-2 font-bold">{{ capitalizar(termo('acompanhamento').plural) }}</h2>
        <p v-if="!acps.data.value?.itens.length" class="text-secundario">Nenhum ainda.</p>
        <RouterLink v-for="a in acps.data.value?.itens ?? []" :key="a.id" :to="`/acompanhamentos/${a.id}`" class="flex min-h-12 items-center justify-between border-t border-zinc-100 py-2 first:border-0 dark:border-zinc-700">
          <span>{{ a.protocolo.nome }} <span class="text-sm text-secundario">· {{ formatarData(a.dataInicio, app.locale) }}</span></span>
          <span class="text-sm">{{ a.status === 'ATIVO' ? `Dia ${a.diaAtual}/${a.totalDias}` : a.status.toLowerCase() }}<strong v-if="a.alertasAbertos" class="ml-2 text-erro">{{ a.alertasAbertos }} alerta(s)</strong></span>
        </RouterLink>
      </Cartao>

      <div class="flex justify-end">
        <Botao v-if="acoes.has('INATIVAR')" variante="fantasma" :carregando="edicao.isPending.value" @click="edicao.mutate({ status: 'INATIVO' })">Inativar</Botao>
        <Botao v-if="acoes.has('REATIVAR')" variante="secundario" :carregando="edicao.isPending.value" @click="edicao.mutate({ status: 'ATIVO' })">Reativar</Botao>
      </div>
      <Conflito v-if="conflito && !editando" @recarregar="recarregar" />

      <Dialogo v-model:aberto="editando" :titulo="`Editar ${termo('paciente').singular}`">
        <Conflito v-if="conflito" class="mb-3" @recarregar="recarregar(); editando = false" />
        <FormPaciente :key="q.data.value?.etag ?? ''" :inicial="p" :enviando="edicao.isPending.value" :erros-servidor="errosServidor" @salvar="salvar" />
      </Dialogo>
      <Dialogo :aberto="!!convite" titulo="Convite para o app" descricao="Mostre o QR code para o paciente ler com a câmera do celular." @update:aberto="(v) => !v && (convite = null)">
        <div v-if="convite" class="flex flex-col items-center gap-3">
          <img :src="convite.qr" alt="QR code do convite" width="260" height="260" class="rounded-lg bg-white p-2" />
          <p class="text-sm">Vale até {{ formatarDataHora(convite.expiraEm, app.fuso, app.locale) }}. <span v-if="convite.emailEnviado">Também enviamos por e-mail.</span></p>
          <Botao variante="secundario" @click="copiar">{{ copiado ? 'Link copiado' : 'Copiar link' }}</Botao>
        </div>
      </Dialogo>
    </template>
  </div>
</template>
