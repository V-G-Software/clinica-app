// Eventos entre instâncias por LISTEN/NOTIFY, incluindo o caso acima do limite de 8000 bytes do NOTIFY.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comOrg, pool } from '../src/db.ts';
import { adicionarOuvinte, emitir, escutarEventos, pararEscuta, type EventoPublico } from '../src/eventos.ts';

const log = { error: () => undefined, warn: () => undefined };

function esperarEvento(usuarioId: string, tipo: string): Promise<EventoPublico> {
  return new Promise((resolver, rejeitar) => {
    const t = setTimeout(() => { remover(); rejeitar(new Error(`evento ${tipo} não chegou`)); }, 3000);
    const remover = adicionarOuvinte({
      org: 'org_vet', usuarioId, sessaoId: 'ses_teste', fechar: () => undefined,
      enviar: (e) => { if (e.tipo === tipo) { clearTimeout(t); remover(); resolver(e); } },
    });
  });
}

describe('eventos', () => {
  beforeAll(() => escutarEventos(log));
  afterAll(async () => { await pararEscuta(); await pool.end(); });

  it('entrega evento pequeno só ao destinatário, após o commit', async () => {
    const chegou = esperarEvento('usr_teste_a', 'teste.pequeno');
    await comOrg('org_vet', (tx) => emitir(tx, 'org_vet', 'teste.pequeno', { x: 1 }, ['usr_teste_a']));
    expect((await chegou).dados).toEqual({ x: 1 });
  });

  it('evento acima do limite do NOTIFY não desfaz a transação e chega inteiro', async () => {
    const texto = 'á'.repeat(6000); // ~12 kB em UTF-8
    const destinatarios = Array.from({ length: 200 }, (_, i) => `usr_muitos_${i}`).concat('usr_teste_b');
    const chegou = esperarEvento('usr_teste_b', 'teste.grande');
    await comOrg('org_vet', (tx) => emitir(tx, 'org_vet', 'teste.grande', { texto }, destinatarios));
    const e = await chegou;
    expect(e.dados).toEqual({ texto });
    expect(e.id).toMatch(/^evt_\d{12}$/);
  });

  it('evento de transação desfeita não é entregue', async () => {
    const tipos: string[] = [];
    const remover = adicionarOuvinte({ org: 'org_vet', usuarioId: 'usr_teste_c', sessaoId: 's', fechar: () => undefined, enviar: (e) => { tipos.push(e.tipo); } });
    await comOrg('org_vet', async (tx) => { await emitir(tx, 'org_vet', 'teste.desfeito', {}, ['usr_teste_c']); throw new Error('desfaz'); }).catch(() => undefined);
    const marco = esperarEvento('usr_teste_c', 'teste.marco');
    await comOrg('org_vet', (tx) => emitir(tx, 'org_vet', 'teste.marco', {}, ['usr_teste_c'])); // chega depois do que seria o desfeito
    await marco;
    remover();
    expect(tipos).toEqual(['teste.marco']);
  });
});
