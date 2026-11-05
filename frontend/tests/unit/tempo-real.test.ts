import { describe, expect, it } from 'vitest';
import { criarParserSse, type MensagemSse } from '@/tempo-real/sse';
import { invalidacoesPara } from '@/tempo-real/invalidacoes';

describe('parser SSE', () => {
  it('lê id, event e data, ignora ping e junta pedaços quebrados', () => {
    const msgs: MensagemSse[] = [];
    const p = criarParserSse((m) => msgs.push(m));
    p('retry: 3000\n\n: ping\n\nid: evt_1\nevent: chat.mensagem.cri');
    p('ada\ndata: {"id":"evt_1"}\n\nid: evt_2\r\ndata: linha1\r\ndata: linha2\r\n\r\n');
    expect(msgs).toEqual([{ id: 'evt_1', event: 'chat.mensagem.criada', data: '{"id":"evt_1"}' }, { id: 'evt_2', data: 'linha1\nlinha2' }]);
  });
});

describe('evento → invalidações', () => {
  const ev = (tipo: string, dados: Record<string, string>) => ({ id: 'e', tipo, ocorridoEm: '', dados });
  it('mensagem nova invalida a conversa, a lista e o início', () => {
    expect(invalidacoesPara(ev('chat.mensagem.criada', { conversaId: 'c1', mensagemId: 'm1' }))).toEqual([['mensagens', 'c1'], ['conversa', 'c1'], ['conversas'], ['inicio']]);
  });
  it('check-in disponível invalida o check-in e o acompanhamento', () => {
    expect(invalidacoesPara(ev('acompanhamento.checkin.disponivel', { checkinId: 'k', acompanhamentoId: 'a' }))).toContainEqual(['acompanhamento', 'a']);
  });
  it('evento desconhecido é ignorado', () => expect(invalidacoesPara(ev('agenda.consulta.marcada', {}))).toEqual([]));
});
