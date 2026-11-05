/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_DIRETORIO_URL?: string;
  readonly VITE_DOMINIO?: string;
  readonly VITE_PERMITIR_ORG?: string;
  readonly VITE_ERROS_URL?: string;
  readonly VITE_ORIGENS_ENVIO?: string;
}
declare const __VERSAO_APP__: string;
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const c: DefineComponent<object, object, unknown>;
  export default c;
}
