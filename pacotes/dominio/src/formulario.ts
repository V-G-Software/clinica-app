// Formulários (9.2): visibilidade e validação de respostas — a mesma regra no backend e no mock.
export interface Campo { id: string; tipo: string; rotulo: string; obrigatorio?: boolean; min?: number; max?: number; casasDecimais?: number; maximo?: number; opcoes?: Array<{ valor: string; rotulo: string }>; visivelSe?: { campo: string; operador: string; valor: unknown } }
export interface ErroCampo { campo: string; codigo: string; mensagem: string }

export function compara(valor: unknown, operador: string, alvo: unknown): boolean {
  if (valor === undefined || valor === null) return false;
  switch (operador) {
    case 'IGUAL': return valor === alvo;
    case 'DIFERENTE': return valor !== alvo;
    case 'MAIOR_OU_IGUAL': return typeof valor === 'number' && valor >= (alvo as number);
    case 'MENOR_OU_IGUAL': return typeof valor === 'number' && valor <= (alvo as number);
    case 'CONTEM': return Array.isArray(valor) ? valor.includes(alvo) : typeof valor === 'string' && valor.includes(String(alvo));
    default: return false;
  }
}
export const campoVisivel = (c: Campo, r: Record<string, unknown>) => !c.visivelSe || compara(r[c.visivelSe.campo], c.visivelSe.operador, c.visivelSe.valor);

/**
 * Valida respostas contra a versão do formulário (RN-FRM-002/003). Campos FOTO são conferidos por
 * `fotoDisponivel` (arquivo do próprio autor, DISPONIVEL e ainda não usado).
 */
export function validarRespostas(campos: Campo[], respostas: Record<string, unknown>, prefixo: string, fotoDisponivel: (id: string) => boolean = () => false): ErroCampo[] {
  const erros: ErroCampo[] = [];
  const err = (campo: string, codigo: string, mensagem: string) => erros.push({ campo: prefixo ? `${prefixo}.${campo}` : campo, codigo, mensagem });
  const ids = new Set(campos.map((c) => c.id));
  for (const k of Object.keys(respostas)) if (!ids.has(k)) err(k, 'DESCONHECIDO', 'Campo não existe neste formulário.');
  for (const c of campos) {
    const v = respostas[c.id];
    const visivel = campoVisivel(c, respostas);
    if (c.tipo === 'INFORMACAO') { if (v !== undefined) err(c.id, 'INVALIDO', 'Campo informativo não recebe valor.'); continue; }
    const vazio = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (vazio) { if (c.obrigatorio && visivel) err(c.id, 'OBRIGATORIO', `Informe: ${c.rotulo}`); continue; }
    if (!visivel) { err(c.id, 'INVALIDO', 'Campo não está visível para estas respostas.'); continue; }
    const tipoErrado = () => err(c.id, 'TIPO_INVALIDO', `Valor inválido para ${c.rotulo}.`);
    switch (c.tipo) {
      case 'TEXTO': case 'TEXTO_LONGO':
        if (typeof v !== 'string') tipoErrado(); else if (v.length > (c.tipo === 'TEXTO' ? 300 : 4000)) err(c.id, 'MUITO_LONGO', 'Texto muito longo.');
        break;
      case 'NUMERO': case 'ESCALA':
        if (typeof v !== 'number' || (c.tipo === 'ESCALA' && !Number.isInteger(v))) { tipoErrado(); break; }
        if ((c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max)) err(c.id, 'FORA_DO_INTERVALO', `Informe um valor entre ${c.min} e ${c.max}.`);
        if (c.tipo === 'NUMERO' && c.casasDecimais !== undefined && Math.round(v * 10 ** c.casasDecimais) / 10 ** c.casasDecimais !== v) err(c.id, 'CASAS_DECIMAIS', `Use até ${c.casasDecimais} casas decimais.`);
        break;
      case 'SIM_NAO': if (typeof v !== 'boolean') tipoErrado(); break;
      case 'ESCOLHA_UNICA': if (!c.opcoes?.some((o) => o.valor === v)) tipoErrado(); break;
      case 'ESCOLHA_MULTIPLA': if (!Array.isArray(v) || !v.every((x) => c.opcoes?.some((o) => o.valor === x))) tipoErrado(); break;
      case 'DATA': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) tipoErrado(); break;
      case 'HORA': if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) tipoErrado(); break;
      case 'FOTO':
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) { tipoErrado(); break; }
        if (c.maximo && v.length > c.maximo) err(c.id, 'MUITOS_ITENS', `Envie no máximo ${c.maximo}.`);
        if (!(v as string[]).every(fotoDisponivel)) err(c.id, 'ARQUIVO_INDISPONIVEL', 'Foto ainda não está disponível.');
        break;
      default: tipoErrado(); // tipo que esta versão do backend não conhece
    }
  }
  return erros;
}
