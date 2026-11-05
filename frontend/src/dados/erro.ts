import { useI18n } from 'vue-i18n';
import { ErroApi } from '@/api/erros';
/** Mensagem do erro pelo `codigo` (nunca o `detail` cru) e código para o suporte. */
export function useMensagemErro() {
  const { t } = useI18n();
  return (e: unknown) => {
    if (!e) return null;
    const x = e instanceof ErroApi ? e : new ErroApi(0, 'DESCONHECIDO', null);
    return { texto: t(`erros.${x.codigo}`, t('erros.DESCONHECIDO')), suporte: x.requestId ? t('app.codigoSuporte', { id: x.requestId }) : null, codigo: x.codigo };
  };
}
