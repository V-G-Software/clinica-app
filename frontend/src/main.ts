import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import { registrarServiceWorker } from './pwa/registro';
import { iniciar } from './app/inicializacao';
import './estilo.css';

const app = createApp(App).use(createPinia());
void iniciar(); // diretório → configuração → sessão, antes da primeira navegação
app
  .use(router)
  .use(i18n)
  .use(VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { staleTime: 30_000, retry: (n, e: any) => n < 2 && (e?.status === 0 || e?.status >= 500) } } } })
  .mount('#app');

registrarServiceWorker();
