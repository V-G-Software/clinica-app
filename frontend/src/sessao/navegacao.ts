// Filtra e organiza o menu do manifesto (7.1): só telas conhecidas, de módulos ativos;
// no máximo 5 itens principais (o excedente vai para "Mais").
import type { Manifesto } from '@clinica/contrato-tipos';
import { caminhoDe, telaPorNome } from '@/catalogo/telas';

export interface ItemMenu {
  id: string; rotulo: string; icone: string; caminho: string; contador?: string; grupo: 'PRINCIPAL' | 'SECUNDARIO';
}
export const MAX_PRINCIPAL = 5;

export function montarMenu(m: Pick<Manifesto, 'navegacao' | 'modulos'>): { principal: ItemMenu[]; secundario: ItemMenu[] } {
  const modulos = new Set(m.modulos.map((x) => x.id as string));
  const itens: ItemMenu[] = [];
  for (const n of m.navegacao as unknown as Array<Record<string, any>>) {
    const def = telaPorNome.get(n?.destino?.tela);
    if (!def || (def.modulo && !modulos.has(def.modulo))) continue; // tela desconhecida ou de módulo inativo
    const caminho = caminhoDe(def.tela, n.destino.parametros ?? {});
    if (!caminho || typeof n.rotulo !== 'string') continue;
    itens.push({ id: String(n.id), rotulo: n.rotulo, icone: n.icone, caminho, contador: n.contador, grupo: n.grupo === 'PRINCIPAL' ? 'PRINCIPAL' : 'SECUNDARIO' });
  }
  const principal = itens.filter((i) => i.grupo === 'PRINCIPAL');
  const excedente = principal.splice(MAX_PRINCIPAL);
  return { principal, secundario: [...excedente.map((i) => ({ ...i, grupo: 'SECUNDARIO' as const })), ...itens.filter((i) => i.grupo === 'SECUNDARIO')] };
}
