<script setup lang="ts">
// Login por etapas (seção 4.2): uma tela por `etapa`, desafioId só em memória.
// Etapa fora do catálogo → pede para atualizar o app (o backend não pode inventar etapas).
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import QRCode from 'qrcode';
import type { RespostaEtapa } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';

type Passo = 'publico' | 'senha' | 'email-codigo' | 'codigo' | 'MFA' | 'CONFIGURAR_MFA' | 'CODIGOS_RECUPERACAO' | 'TROCAR_SENHA' | 'ACEITAR_TERMOS' | 'desconhecida';

const { t } = useI18n();
const app = useAppStore();
const sessao = useSessaoStore();
const router = useRouter();
const rota = useRoute();
const cfg = computed(() => app.config!);

const publicos = computed(() => [...new Set(cfg.value.autenticacao.metodos.map((m) => m.publico))]);
const metodoDe = (p: string) => cfg.value.autenticacao.metodos.find((m) => m.publico === p)?.tipo;
const passoInicial = (p: string): Passo => (metodoDe(p) === 'SENHA' ? 'senha' : 'email-codigo');

const passo = ref<Passo>(publicos.value.length === 1 ? passoInicial(publicos.value[0]) : 'publico');
const email = ref('');
const senha = ref('');
const codigo = ref('');
const novaSenha = ref('');
const usarRecuperacao = ref(false);
const desafioId = ref<string | null>(null);
const termos = ref<{ versao: string; url: string } | null>(null);
const qr = ref<string | null>(null);
const segredo = ref<string | null>(null);
const codigosRecuperacao = ref<string[]>([]);
const conclusaoPendente = ref<{ tokenAcesso: string; expiraEm: string } | null>(null);
const carregando = ref(false);
const erro = ref<ErroApi | null>(null);
const erroCampo = ref<Record<string, string>>({});
const espera = ref(0);
let relogio: ReturnType<typeof setInterval> | undefined;
onUnmounted(() => clearInterval(relogio));

const mensagemErro = computed(() => (erro.value ? t(`erros.${erro.value.codigo}`, t('erros.DESCONHECIDO')) : null));
const emailNormalizado = () => email.value.trim().toLowerCase();

async function executar(fn: () => Promise<void>) {
  carregando.value = true; erro.value = null; erroCampo.value = {};
  try { await fn(); } catch (e) {
    erro.value = e instanceof ErroApi ? e : new ErroApi(0, 'DESCONHECIDO', null);
    erroCampo.value = erro.value.porCampo();
  } finally { carregando.value = false; }
}

async function tratar(r: RespostaEtapa) {
  codigo.value = '';
  desafioId.value = r.desafioId ?? desafioId.value;
  if (r.codigosRecuperacao?.length) codigosRecuperacao.value = r.codigosRecuperacao;
  switch (r.etapa) {
    case 'CONCLUIDO':
      if (codigosRecuperacao.value.length) { conclusaoPendente.value = { tokenAcesso: r.tokenAcesso!, expiraEm: r.expiraEm! }; passo.value = 'CODIGOS_RECUPERACAO'; return; }
      return concluir({ tokenAcesso: r.tokenAcesso!, expiraEm: r.expiraEm! });
    case 'MFA': passo.value = 'MFA'; return;
    case 'CODIGO_ENVIADO': passo.value = 'codigo'; return;
    case 'TROCAR_SENHA': passo.value = 'TROCAR_SENHA'; return;
    case 'ACEITAR_TERMOS': termos.value = r.termos ?? null; passo.value = 'ACEITAR_TERMOS'; return;
    case 'CONFIGURAR_MFA': {
      passo.value = 'CONFIGURAR_MFA';
      const ini = await ok(api().POST('/v1/auth/mfa/totp/iniciar', { body: { desafioId: desafioId.value! } }));
      segredo.value = ini.segredo;
      qr.value = await QRCode.toDataURL(ini.uriOtpauth, { margin: 1, width: 220 });
      return;
    }
    default: passo.value = 'desconhecida';
  }
}

async function concluir(tk: { tokenAcesso: string; expiraEm: string }) {
  await sessao.concluirLogin(tk);
  const voltar = typeof rota.query.voltar === 'string' && rota.query.voltar.startsWith('/') ? rota.query.voltar : '/';
  await router.replace(voltar);
}

const entrar = () => executar(async () => tratar(await ok(api().POST('/v1/auth/entrar', { body: { email: emailNormalizado(), senha: senha.value } }))));
const pedirCodigo = () => executar(async () => {
  await ok(api().POST('/v1/auth/codigo/solicitar', { body: { email: emailNormalizado() } }));
  passo.value = 'codigo';
  espera.value = 30;
  clearInterval(relogio);
  relogio = setInterval(() => { if (--espera.value <= 0) clearInterval(relogio); }, 1000);
});
const verificarCodigo = () => executar(async () => tratar(await ok(api().POST('/v1/auth/codigo/verificar', { body: { email: emailNormalizado(), codigo: codigo.value, ...(desafioId.value ? { desafioId: desafioId.value } : {}) } }))));
const verificarMfa = () => executar(async () => tratar(await ok(api().POST('/v1/auth/mfa/verificar', { body: { desafioId: desafioId.value!, codigo: codigo.value.trim() } }))));
const confirmarTotp = () => executar(async () => tratar(await ok(api().POST('/v1/auth/mfa/totp/confirmar', { body: { desafioId: desafioId.value!, codigo: codigo.value } }))));
const trocarSenha = () => executar(async () => tratar(await ok(api().POST('/v1/auth/senha/trocar', { body: { desafioId: desafioId.value!, novaSenha: novaSenha.value } }))));
const aceitarTermos = () => executar(async () => tratar(await ok(api().POST('/v1/auth/termos/aceitar', { body: { desafioId: desafioId.value!, termosVersao: termos.value?.versao ?? cfg.value.autenticacao.termosVersao } }))));
const guardeiCodigos = () => executar(async () => { const tk = conclusaoPendente.value!; codigosRecuperacao.value = []; await concluir(tk); });
const copiado = ref(false);
async function copiarCodigos() { await navigator.clipboard?.writeText(codigosRecuperacao.value.join('\n')); copiado.value = true; }
function escolher(p: string) { passo.value = passoInicial(p); }
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
    <header class="flex flex-col items-center gap-3 text-center">
      <img v-if="cfg.tema.logoUrl" :src="cfg.tema.logoUrl" alt="" class="h-14" @error="($event.target as HTMLImageElement).style.display = 'none'" />
      <h1 class="text-2xl font-bold text-marca-700 dark:text-marca-200">{{ cfg.organizacao.nome }}</h1>
      <p v-if="passo === 'publico' || passo === 'email-codigo' || passo === 'senha'" class="text-zinc-600 dark:text-zinc-300">
        <strong class="block text-lg text-zinc-900 dark:text-zinc-100">{{ cfg.textos.boasVindasTitulo }}</strong>{{ cfg.textos.boasVindasTexto }}
      </p>
    </header>

    <Aviso v-if="sessao.motivoSaida && passo === 'publico'" tipo="atencao">{{ t('auth.sessaoEncerrada') }}</Aviso>
    <Aviso v-if="mensagemErro && !Object.keys(erroCampo).length" tipo="erro" :detalhe="erro?.requestId ? t('app.codigoSuporte', { id: erro.requestId }) : null">{{ mensagemErro }}</Aviso>

    <!-- Escolha de público -->
    <div v-if="passo === 'publico'" class="flex flex-col gap-3">
      <Botao v-if="publicos.includes('PACIENTE')" bloco @click="escolher('PACIENTE')">{{ t('auth.souPaciente', { paciente: 'paciente ou responsável' }) }}</Botao>
      <Botao v-if="publicos.includes('EQUIPE')" bloco variante="secundario" @click="escolher('EQUIPE')">{{ t('auth.souEquipe') }}</Botao>
    </div>

    <!-- Equipe: e-mail e senha -->
    <form v-else-if="passo === 'senha'" class="flex flex-col gap-4" @submit.prevent="entrar">
      <CampoTexto v-model="email" :rotulo="t('auth.email')" tipo="email" autocomplete="username" inputmode="email" obrigatorio :erro="erroCampo.email" />
      <CampoTexto v-model="senha" :rotulo="t('auth.senha')" tipo="password" autocomplete="current-password" obrigatorio :erro="erroCampo.senha" />
      <Botao tipo="submit" bloco :carregando="carregando">{{ t('auth.entrar') }}</Botao>
      <Botao v-if="publicos.length > 1" variante="fantasma" @click="passo = 'publico'">{{ t('app.voltar') }}</Botao>
    </form>

    <!-- Paciente: e-mail para receber código -->
    <form v-else-if="passo === 'email-codigo'" class="flex flex-col gap-4" @submit.prevent="pedirCodigo">
      <CampoTexto v-model="email" :rotulo="t('auth.email')" tipo="email" autocomplete="email" inputmode="email" obrigatorio autofocus :erro="erroCampo.email" />
      <Botao tipo="submit" bloco :carregando="carregando">{{ t('auth.enviarCodigo') }}</Botao>
      <Botao v-if="publicos.length > 1" variante="fantasma" @click="passo = 'publico'">{{ t('app.voltar') }}</Botao>
    </form>

    <!-- Código por e-mail -->
    <form v-else-if="passo === 'codigo'" class="flex flex-col gap-4" @submit.prevent="verificarCodigo">
      <p class="text-center">{{ t('auth.codigoEnviadoPara', { email: emailNormalizado() }) }}</p>
      <CampoTexto v-model="codigo" :rotulo="t('auth.codigo')" autocomplete="one-time-code" inputmode="numeric" :maxlength="6" obrigatorio autofocus
        classe-entrada="text-center text-2xl tracking-[0.5em] font-mono" :erro="erroCampo.codigo" />
      <Botao tipo="submit" bloco :carregando="carregando" :desabilitado="codigo.length !== 6">{{ t('app.continuar') }}</Botao>
      <Botao variante="fantasma" :desabilitado="espera > 0" @click="pedirCodigo">{{ espera > 0 ? t('auth.reenviarEm', { s: espera }) : t('auth.reenviar') }}</Botao>
    </form>

    <!-- MFA -->
    <form v-else-if="passo === 'MFA'" class="flex flex-col gap-4" @submit.prevent="verificarMfa">
      <div><h2 class="text-xl font-bold">{{ t('auth.mfaTitulo') }}</h2><p class="text-zinc-600 dark:text-zinc-300">{{ t('auth.mfaTexto') }}</p></div>
      <CampoTexto v-if="!usarRecuperacao" v-model="codigo" :rotulo="t('auth.codigo')" autocomplete="one-time-code" inputmode="numeric" :maxlength="6" obrigatorio autofocus
        classe-entrada="text-center text-2xl tracking-[0.5em] font-mono" />
      <CampoTexto v-else v-model="codigo" :rotulo="t('auth.codigoRecuperacao')" autocomplete="off" obrigatorio autofocus classe-entrada="font-mono uppercase" />
      <Botao tipo="submit" bloco :carregando="carregando">{{ t('app.continuar') }}</Botao>
      <Botao variante="fantasma" @click="usarRecuperacao = !usarRecuperacao; codigo = ''">{{ usarRecuperacao ? t('auth.codigo') : t('auth.usarRecuperacao') }}</Botao>
    </form>

    <!-- Configurar MFA -->
    <form v-else-if="passo === 'CONFIGURAR_MFA'" class="flex flex-col gap-4" @submit.prevent="confirmarTotp">
      <div><h2 class="text-xl font-bold">{{ t('auth.configurarMfaTitulo') }}</h2><p class="text-zinc-600 dark:text-zinc-300">{{ t('auth.configurarMfaTexto') }}</p></div>
      <img v-if="qr" :src="qr" alt="QR code para o aplicativo autenticador" class="mx-auto rounded-lg bg-white p-2" width="220" height="220" />
      <p v-if="segredo" class="text-center text-sm">{{ t('auth.segredoManual') }}<br /><code class="font-mono text-base break-all select-all">{{ segredo }}</code></p>
      <CampoTexto v-model="codigo" :rotulo="t('auth.codigo')" autocomplete="one-time-code" inputmode="numeric" :maxlength="6" obrigatorio classe-entrada="text-center text-2xl tracking-[0.5em] font-mono" />
      <Botao tipo="submit" bloco :carregando="carregando" :desabilitado="codigo.length !== 6">{{ t('app.continuar') }}</Botao>
    </form>

    <!-- Códigos de recuperação -->
    <div v-else-if="passo === 'CODIGOS_RECUPERACAO'" class="flex flex-col gap-4">
      <div><h2 class="text-xl font-bold">{{ t('auth.codigosRecuperacaoTitulo') }}</h2><p class="text-zinc-600 dark:text-zinc-300">{{ t('auth.codigosRecuperacaoTexto') }}</p></div>
      <Cartao><ul class="grid grid-cols-2 gap-2 font-mono"><li v-for="c in codigosRecuperacao" :key="c">{{ c }}</li></ul></Cartao>
      <Botao variante="secundario" bloco @click="copiarCodigos">{{ copiado ? t('auth.copiado') : t('auth.copiar') }}</Botao>
      <Botao bloco :carregando="carregando" @click="guardeiCodigos">{{ t('auth.guardei') }}</Botao>
    </div>

    <!-- Trocar senha -->
    <form v-else-if="passo === 'TROCAR_SENHA'" class="flex flex-col gap-4" @submit.prevent="trocarSenha">
      <h2 class="text-xl font-bold">{{ t('auth.trocarSenhaTitulo') }}</h2>
      <CampoTexto v-model="novaSenha" :rotulo="t('auth.novaSenha')" tipo="password" autocomplete="new-password" obrigatorio :ajuda="t('auth.regraSenha')" :erro="erroCampo.novaSenha" />
      <Botao tipo="submit" bloco :carregando="carregando" :desabilitado="novaSenha.length < 10">{{ t('app.continuar') }}</Botao>
    </form>

    <!-- Termos -->
    <div v-else-if="passo === 'ACEITAR_TERMOS'" class="flex flex-col gap-4">
      <div><h2 class="text-xl font-bold">{{ t('auth.termosTitulo') }}</h2><p class="text-zinc-600 dark:text-zinc-300">{{ t('auth.termosTexto') }}</p></div>
      <a :href="termos?.url ?? cfg.links.termosDeUso" target="_blank" rel="noopener noreferrer" class="text-acao underline">{{ t('auth.lerTermos') }}</a>
      <Botao bloco :carregando="carregando" @click="aceitarTermos">{{ t('auth.aceito') }}</Botao>
    </div>

    <Aviso v-else tipo="erro">{{ t('auth.etapaDesconhecida') }}</Aviso>
  </main>
</template>
