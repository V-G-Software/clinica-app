import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import { registrarServiceWorker } from './pwa/registro';
import { iniciar } from './app/inicializacao';
import { clienteConsultas } from './dados/consultas';
import { ligarTempoReal } from './tempo-real/integracao';
import './estilo.css';

const app = createApp(App).use(createPinia());
void iniciar(); // diretório → configuração → sessão, antes da primeira navegação
app
  .use(router)
  .use(i18n)
  .use(VueQueryPlugin, { queryClient: clienteConsultas })
  .mount('#app');
ligarTempoReal();

registrarServiceWorker();
