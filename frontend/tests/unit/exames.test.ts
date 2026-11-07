// Exames: utilitários de tela, rotas dos destinos de notificação e invalidação pelos eventos do módulo.
import { describe, expect, it } from 'vitest';
import { intervaloRenovacao, tamanho, tituloSugerido } from '@/telas/exames/util';
import { invalidacoesPara } from '@/tempo-real/invalidacoes';
import { caminhoDe } from '@/catalogo/telas';
import { iconePorNome } from '@/catalogo/icones';
import { CircleHelp } from 'lucide-vue-next';

describe('exames: utilitários', () => {
  it('título sugerido junta os itens do pedido e respeita o limite do contrato (200)', () => {
    expect(tituloSugerido({ itens: [{ nome: 'Hemograma', orientacoes: null }, { nome: 'Glicemia', orientacoes: 'jejum' }] })).toBe('Hemograma, Glicemia');
    expect(tituloSugerido(undefined)).toBe('');
    const longo = tituloSugerido({ itens: Array.from({ length: 30 }, (_, i) => ({ nome: `Exame número ${i}`, orientacoes: null })) });
    expect(longo.length).toBe(198);
  });
  it('tamanho legível', () => {
    expect(tamanho(500)).toBe('1 KB');
    expect(tamanho(850 * 1024)).toBe('850 KB');
    expect(tamanho(2.4 * 1024 * 1024)).toBe('2,4 MB');
  });
  it('renova as URLs assinadas 30 s antes de expirarem, nunca em menos de 30 s', () => {
    const agora = Date.parse('2026-11-08T13:30:00Z');
    expect(intervaloRenovacao('2026-11-08T13:35:00Z', agora)).toBe(270_000);
    expect(intervaloRenovacao('2026-11-08T13:30:10Z', agora)).toBe(30_000);
    expect(intervaloRenovacao(null, agora)).toBe(false);
  });
});

describe('exames: rotas, ícone e tempo real', () => {
  it('destinos de notificação abrem pedido e resultado; atalhos aceitam contexto', () => {
    expect(caminhoDe('exames.pedido', { pedidoId: 'pex_1' })).toBe('/exames/pedidos/pex_1');
    expect(caminhoDe('exames.resultado', { resultadoId: 'rex_1' })).toBe('/exames/resultados/rex_1');
    expect(caminhoDe('exames.novo', { pacienteId: 'pac_1' })).toBe('/exames/novo?pacienteId=pac_1');
    expect(caminhoDe('exames.enviar', { pedidoId: 'pex_1', pacienteId: 'pac_1' })).toBe('/exames/enviar?pacienteId=pac_1&pedidoId=pex_1');
    expect(caminhoDe('exames.meus')).toBe('/exames/meus');
    expect(caminhoDe('agenda.novo', { pacienteId: 'pac_1' })).toBe('/agenda/novo?pacienteId=pac_1');
  });
  it('ícone do módulo existe no catálogo', () => {
    expect(iconePorNome('flask-conical')).not.toBe(CircleHelp);
  });
  it('eventos invalidam detalhe, listas, pedido ligado e a tela inicial', () => {
    expect(invalidacoesPara({ id: 'e', tipo: 'exames.pedido.atualizado', ocorridoEm: '', dados: { pedidoId: 'pex_1' } }))
      .toEqual([['exame-pedido', 'pex_1'], ['exames-pedidos'], ['inicio']]);
    expect(invalidacoesPara({ id: 'e', tipo: 'exames.resultado.atualizado', ocorridoEm: '', dados: { resultadoId: 'rex_1', pedidoId: 'pex_1' } }))
      .toEqual([['exame-resultado', 'rex_1'], ['exames-resultados'], ['exame-pedido', 'pex_1'], ['inicio']]);
    expect(invalidacoesPara({ id: 'e', tipo: 'exames.resultado.atualizado', ocorridoEm: '', dados: { resultadoId: 'rex_2' } }))
      .toEqual([['exame-resultado', 'rex_2'], ['exames-resultados'], ['inicio']]);
  });
});
