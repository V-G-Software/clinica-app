import { createI18n } from 'vue-i18n';
import ptBR from './pt-BR.json';

export type Mensagens = typeof ptBR;
export const i18n = createI18n<[Mensagens], 'pt-BR'>({
  legacy: false,
  locale: 'pt-BR',
  fallbackLocale: 'pt-BR',
  messages: { 'pt-BR': ptBR },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: false,
});
/** Idioma da organização; sem tradução disponível, fica em pt-BR. */
export function definirIdioma(locale: string) {
  const disponiveis = i18n.global.availableLocales as string[];
  (i18n.global.locale as unknown as { value: string }).value = disponiveis.includes(locale) ? locale : 'pt-BR';
  document.documentElement.lang = locale;
}
