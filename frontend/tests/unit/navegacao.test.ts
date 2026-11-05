import { describe, expect, it } from 'vitest';
import { caminhoDe } from '@/catalogo/telas';
import { montarMenu } from '@/sessao/navegacao';
import { iconePorNome } from '@/catalogo/icones';
import { CircleHelp, House } from 'lucide-vue-next';

const item = (id: string, tela: string, grupo = 'PRINCIPAL', extra: Record<string, unknown> = {}) => ({ id, rotulo: id, icone: 'house', grupo, destino: { tela }, ...extra });
const modulos = [{ id: 'chat', versao: '1.0', config: {} }, { id: 'acompanhamento', versao: '1.0', config: {} }];

describe('menu a partir do manifesto (compatível para frente)', () => {
  it('ignora tela desconhecida e tela de módulo inativo', () => {
    const m = montarMenu({ modulos, navegacao: [item('inicio', 'inicio'), item('agenda', 'agenda.lista'), item('pacientes', 'pacientes.lista'), item('conversas', 'chat.lista')] } as any);
    expect(m.principal.map((i) => i.id)).toEqual(['inicio', 'conversas']);
  });
  it('no máximo 5 itens principais; o excedente vai para "Mais"', () => {
    const nav = ['inicio', 'notificacoes', 'perfil', 'chat.lista', 'acompanhamento.lista', 'acompanhamento.protocolos'].map((t, i) => item(`i${i}`, t));
    const m = montarMenu({ modulos, navegacao: [...nav, item('s', 'organizacao.configuracao', 'SECUNDARIO')] } as any);
    expect(m.principal).toHaveLength(5);
    expect(m.secundario.map((i) => i.id)).toEqual(['i5', 's']);
  });
  it('campos e valores desconhecidos não quebram', () => {
    const m = montarMenu({ modulos, navegacao: [item('x', 'inicio', 'NOVO_GRUPO', { campoNovo: 1, contador: 'novo.contador' })] } as any);
    expect(m.secundario[0]).toMatchObject({ id: 'x', caminho: '/' });
  });
  it('ícone desconhecido vira genérico', () => { expect(iconePorNome('house')).toBe(House); expect(iconePorNome('foguete')).toBe(CircleHelp); });
  it('caminho com parâmetros (ids opacos) e parâmetro faltando', () => {
    expect(caminhoDe('chat.conversa', { conversaId: 'cnv_1' })).toBe('/conversas/cnv_1');
    expect(caminhoDe('chat.conversa', {})).toBeNull();
    expect(caminhoDe('tela.inexistente')).toBeNull();
  });
});
