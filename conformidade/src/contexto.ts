// Acesso ao ambiente preparado no globalSetup.
import { inject } from 'vitest';
import { criarCliente } from './cliente.ts';
import { registrarJanelaUsada } from './totp.ts';

export function ambiente() {
  const a = inject('ambiente');
  for (const [s, j] of Object.entries(a.janelasTotp)) registrarJanelaUsada(s, j);
  return { ...a, api: criarCliente(a.urlApi) };
}
export const temModulo = (a: { modulos: string[] }, id: string) => a.modulos.includes(id);
