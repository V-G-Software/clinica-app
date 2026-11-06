<script setup lang="ts">
// Configurações da organização (gestor): nome, contato, marca (com prévia e contraste), logo,
// textos de boas-vindas, regras do chat e do acompanhamento. Salvar emite `sessao.manifesto.alterado` (RN-EQP-004).
import { computed, reactive, ref, watch } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2 } from 'lucide-vue-next';
import { api } from '@/api';
import { ErroApi } from '@/api/erros';
import { comEtag } from '@/dados/etag';
import { useMensagemErro } from '@/dados/erro';
import { enviarArquivo } from '@/dados/arquivos';
import { contraste, corComContraste } from '@/app/cor';
import { FUNDO_CLARO } from '@/app/tema';
import { formatarTelefone, paraE164 } from '@/i18n/telefone';
import { useSessaoStore } from '@/sessao/store';
import { useAppStore } from '@/app/store';
import { aplicarMarca } from '@/app/tema';
import { TERMOS_PADRAO, artigoPlural, capitalizar, type Termo } from '@/i18n/termos';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Conflito from '@/ds/Conflito.vue';

const { t } = useI18n();
const msg = useMensagemErro();
const sessao = useSessaoStore();
const app = useAppStore();
async function reaplicarMarca() {
  const r = await fetch(`${app.organizacao!.urlApi}/v1/publico/configuracao`, { cache: 'no-store' }).catch(() => null);
  if (r?.ok) { app.config = await r.json(); aplicarMarca(app.config!, { dev: import.meta.env.DEV }); }
}
const q = useQuery({ queryKey: ['organizacao'], queryFn: () => comEtag(api().GET('/v1/organizacao', {})) });
const f = reactive({ nome: '', telefone: '', email: '', endereco: '', cor: '#000000', boasVindasTitulo: '', boasVindasTexto: '', mensagemForaDoHorario: '', avisoUrgencia: '', horario: [] as Array<{ diaSemana: number; inicio: string; fim: string }>, logoArquivoId: undefined as string | null | undefined, resolverAlertasAoEncerrar: false,
  agenda: null as null | { autoagendamento: boolean; antecedenciaMinimaHoras: number; janelaDias: number; cancelamentoAteHoras: number; lembreteHorasAntes: number; intervaloMinutos: 5 | 10 | 15 | 20 | 30 | 60 } });
watch(() => q.data.value, (d) => {
  if (!d) return;
  const o = d.dado;
  Object.assign(f, { nome: o.nome, telefone: formatarTelefone(o.contato.telefone), email: o.contato.email ?? '', endereco: o.contato.endereco ?? '', cor: o.tema.corMarca, boasVindasTitulo: o.textos.boasVindasTitulo, boasVindasTexto: o.textos.boasVindasTexto, mensagemForaDoHorario: o.chat.mensagemForaDoHorario ?? '', avisoUrgencia: o.chat.avisoUrgencia ?? '', horario: o.chat.horarioAtendimento.map((h) => ({ ...h })), logoArquivoId: undefined, resolverAlertasAoEncerrar: o.acompanhamento?.resolverAlertasAoEncerrar ?? false, agenda: o.agenda ? { ...o.agenda } : null });
}, { immediate: true });
const temChat = computed(() => sessao.modulos.has('chat'));
// Presente só com o módulo contratado (o backend omite o bloco sem ele).
const temAcompanhamento = computed(() => !!q.data.value?.dado.acompanhamento);
const termo = (k: string): Termo => ((sessao.termos as Record<string, Termo> | undefined)?.[k] ?? TERMOS_PADRAO[k]);
const corValida = computed(() => /^#[0-9a-fA-F]{6}$/.test(f.cor));
const ajuste = computed(() => (corValida.value ? corComContraste(f.cor, FUNDO_CLARO) : null));
const conflito = ref(false);
const salvo = ref(false);
const enviandoLogo = ref(false);
async function escolherLogo(e: Event) {
  const a = (e.target as HTMLInputElement).files?.[0];
  if (!a) return;
  enviandoLogo.value = true;
  try { f.logoArquivoId = (await enviarArquivo(a, 'ORGANIZACAO')).id; } finally { enviandoLogo.value = false; }
}
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const salvar = useMutation({
  mutationFn: () => comEtag(api().PATCH('/v1/organizacao', {
    params: { header: { 'If-Match': q.data.value?.etag ?? '' } },
    body: {
      nome: f.nome.trim(),
      contato: { telefone: paraE164(f.telefone), email: f.email.trim().toLowerCase() || null, endereco: f.endereco.trim() || null },
      tema: { corMarca: f.cor.toUpperCase(), ...(f.logoArquivoId !== undefined ? { logoArquivoId: f.logoArquivoId } : {}) },
      textos: { boasVindasTitulo: f.boasVindasTitulo, boasVindasTexto: f.boasVindasTexto },
      ...(temAcompanhamento.value ? { acompanhamento: { resolverAlertasAoEncerrar: f.resolverAlertasAoEncerrar } } : {}),
      ...(f.agenda ? { agenda: { ...f.agenda } } : {}),
      ...(temChat.value ? { chat: { horarioAtendimento: f.horario, mensagemForaDoHorario: f.mensagemForaDoHorario || null, avisoUrgencia: f.avisoUrgencia || null } } : {}),
    },
  })),
  onSuccess: (r) => { q.data.value && Object.assign(q.data.value, r); void reaplicarMarca(); salvo.value = true; conflito.value = false; void q.refetch(); setTimeout(() => (salvo.value = false), 3000); },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; },
});
const entrada = 'min-h-11 rounded-lg border-2 border-zinc-300 bg-white px-3 dark:border-zinc-600 dark:bg-zinc-800';
</script>
<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <h1 class="text-2xl font-bold">Configurações</h1>
    <p v-if="q.isPending.value">{{ t('app.carregando') }}</p>
    <form v-else-if="q.data.value" class="flex flex-col gap-4" novalidate @submit.prevent="salvar.mutate()">
      <Conflito v-if="conflito" @recarregar="q.refetch()" />
      <Aviso v-if="salvar.error.value && !conflito" tipo="erro" :detalhe="msg(salvar.error.value)?.suporte">{{ msg(salvar.error.value)?.texto }}</Aviso>
      <Aviso v-if="salvo">Salvo. O app de todos os usuários é atualizado automaticamente.</Aviso>
      <Cartao class="flex flex-col gap-3">
        <h2 class="font-bold">Organização</h2>
        <CampoTexto v-model="f.nome" rotulo="Nome" />
        <CampoTexto v-model="f.telefone" rotulo="Telefone" inputmode="tel" />
        <CampoTexto v-model="f.email" rotulo="E-mail de contato" tipo="email" />
        <CampoTexto v-model="f.endereco" rotulo="Endereço" />
      </Cartao>
      <Cartao class="flex flex-col gap-3">
        <h2 class="font-bold">Marca</h2>
        <div class="flex items-end gap-3">
          <label class="flex flex-col gap-1 text-sm">Cor<input v-model="f.cor" type="color" class="h-11 w-16 rounded-lg" /></label>
          <label class="flex flex-col gap-1 text-sm">Código<input v-model="f.cor" maxlength="7" :class="entrada" class="w-28 font-mono" /></label>
          <span v-if="ajuste" class="flex min-h-11 items-center rounded-lg px-4 font-semibold" :style="{ background: ajuste.cor, color: contraste(ajuste.cor, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#18181B' }">Prévia do botão</span>
        </div>
        <Aviso v-if="ajuste?.ajustada" tipo="atencao">Essa cor tem pouco contraste com o fundo branco. Nos botões e links, o app vai usar um tom ajustado ({{ ajuste.cor }}) para continuar legível.</Aviso>
        <label class="flex flex-col gap-1 text-sm">Logo (PNG, JPEG ou WebP)<input type="file" accept="image/png,image/jpeg,image/webp" @change="escolherLogo" /></label>
        <p v-if="enviandoLogo" class="text-sm">Enviando logo…</p>
        <p v-else-if="f.logoArquivoId" class="text-sm text-sucesso">Logo pronto para salvar.</p>
      </Cartao>
      <Cartao class="flex flex-col gap-3">
        <h2 class="font-bold">Tela de entrada</h2>
        <CampoTexto v-model="f.boasVindasTitulo" rotulo="Título" :maxlength="120" />
        <label class="flex flex-col gap-1 text-sm">Texto<textarea v-model="f.boasVindasTexto" rows="2" maxlength="500" :class="entrada" class="py-2" /></label>
      </Cartao>
      <Cartao v-if="temChat" class="flex flex-col gap-3">
        <h2 class="font-bold">Conversas</h2>
        <p class="text-sm font-medium">Horário de atendimento</p>
        <div v-for="(h, i) in f.horario" :key="i" class="flex flex-wrap items-center gap-2">
          <select v-model.number="h.diaSemana" :class="entrada" aria-label="Dia"><option v-for="(d, n) in DIAS" :key="n" :value="n">{{ d }}</option></select>
          <input v-model="h.inicio" type="time" :class="entrada" aria-label="Início" /> até <input v-model="h.fim" type="time" :class="entrada" aria-label="Fim" />
          <button type="button" class="p-2" aria-label="Remover horário" @click="f.horario.splice(i, 1)"><Trash2 class="size-5" /></button>
        </div>
        <Botao variante="fantasma" @click="f.horario.push({ diaSemana: 1, inicio: '08:00', fim: '18:00' })"><Plus class="size-4" /> Horário</Botao>
        <label class="flex flex-col gap-1 text-sm">Mensagem automática fora do horário<textarea v-model="f.mensagemForaDoHorario" rows="2" maxlength="500" :class="entrada" class="py-2" /></label>
        <label class="flex flex-col gap-1 text-sm">Aviso de urgência (fixo no topo da conversa do paciente)<textarea v-model="f.avisoUrgencia" rows="2" maxlength="500" :class="entrada" class="py-2" /></label>
        <Aviso tipo="atencao">Revise o aviso de urgência com um profissional e com o jurídico antes de usar com pacientes.</Aviso>
      </Cartao>
      <Cartao v-if="temAcompanhamento" class="flex flex-col gap-3">
        <h2 class="font-bold">{{ capitalizar(termo('acompanhamento').plural) }}</h2>
        <label class="flex items-start gap-3">
          <input v-model="f.resolverAlertasAoEncerrar" type="checkbox" class="mt-0.5 size-5 shrink-0" />
          <span>
            Resolver os alertas abertos ao encerrar ou concluir {{ artigoPlural(termo('acompanhamento')) }} {{ termo('acompanhamento').plural }}
            <span class="block text-sm text-secundario">Cada alerta fica registrado como resolvido por quem encerrou (ou pelo sistema, na conclusão automática). Desligado, os alertas continuam abertos até alguém resolver.</span>
          </span>
        </label>
      </Cartao>
      <Cartao v-if="f.agenda" class="flex flex-col gap-3">
        <h2 class="font-bold">Agenda</h2>
        <label class="flex items-start gap-3">
          <input v-model="f.agenda.autoagendamento" type="checkbox" class="mt-0.5 size-5 shrink-0" />
          <span>{{ capitalizar(termo('paciente').singular) }} marca pelo app
            <span class="block text-sm text-secundario">Só nos serviços marcados como autoagendáveis e nos horários livres da grade.</span></span>
        </label>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <label class="flex flex-col gap-1">Antecedência mínima (horas)<input v-model.number="f.agenda.antecedenciaMinimaHoras" type="number" min="0" max="720" :class="entrada" /></label>
          <label class="flex flex-col gap-1">Até quantos dias à frente<input v-model.number="f.agenda.janelaDias" type="number" min="1" max="365" :class="entrada" /></label>
          <label class="flex flex-col gap-1">Cancelar pelo app até (horas antes)<input v-model.number="f.agenda.cancelamentoAteHoras" type="number" min="0" max="720" :class="entrada" /></label>
          <label class="flex flex-col gap-1">Lembrete (horas antes)<input v-model.number="f.agenda.lembreteHorasAntes" type="number" min="1" max="168" :class="entrada" /></label>
          <label class="flex flex-col gap-1">Intervalo entre horários<select v-model.number="f.agenda.intervaloMinutos" :class="entrada"><option v-for="n in [5, 10, 15, 20, 30, 60]" :key="n" :value="n">{{ n }} min</option></select></label>
        </div>
        <p class="text-sm text-secundario">Mudar o lembrete vale para os próximos agendamentos e remarcações.</p>
      </Cartao>
      <Botao tipo="submit" bloco :carregando="salvar.isPending.value" :desabilitado="!corValida || f.nome.trim().length < 2">Salvar</Botao>
    </form>
  </div>
</template>
