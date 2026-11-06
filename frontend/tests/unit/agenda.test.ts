// Agenda: conversão data/hora local da organização → UTC (o que a pessoa digita vs. o que trafega),
// agrupamento por dia local e invalidação pelos eventos do módulo.
import { describe, expect, it } from 'vitest';
import { diaNoFuso, inicioDaSemana, paraUtc, porDia } from '@/telas/agenda/util';
import { invalidacoesPara } from '@/tempo-real/invalidacoes';
import { caminhoDe } from '@/catalogo/telas';

describe('agenda: datas no fuso da organização', () => {
  it('converte hora local para UTC sem depender do fuso do aparelho', () => {
    expect(paraUtc('2026-11-10', '09:00', 'America/Sao_Paulo')).toBe('2026-11-10T12:00:00.000Z');
    expect(paraUtc('2026-11-10', '09:00', 'America/Manaus')).toBe('2026-11-10T13:00:00.000Z');
    expect(paraUtc('2026-11-10', '00:00', 'America/Sao_Paulo')).toBe('2026-11-10T03:00:00.000Z');
  });
  it('acerta os dois lados de uma virada de horário de verão', () => {
    // Nova York: horário de verão termina em 2026-11-01 (02:00 EDT → 01:00 EST).
    expect(paraUtc('2026-10-31', '09:00', 'America/New_York')).toBe('2026-10-31T13:00:00.000Z');
    expect(paraUtc('2026-11-02', '09:00', 'America/New_York')).toBe('2026-11-02T14:00:00.000Z');
  });
  it('dia local de um instante: 23h30 em São Paulo ainda é o mesmo dia (já é o seguinte em UTC)', () => {
    expect(diaNoFuso('2026-11-11T02:30:00Z', 'America/Sao_Paulo')).toBe('2026-11-10');
  });
  it('semana começa na segunda; domingo pertence à semana anterior', () => {
    expect(inicioDaSemana('2026-11-11')).toBe('2026-11-09'); // quarta
    expect(inicioDaSemana('2026-11-08')).toBe('2026-11-02'); // domingo
    expect(inicioDaSemana('2026-11-09')).toBe('2026-11-09'); // segunda
  });
  it('agrupa por dia local, em ordem', () => {
    const g = porDia([{ inicioEm: '2026-11-11T12:00:00Z' }, { inicioEm: '2026-11-11T02:30:00Z' }, { inicioEm: '2026-11-10T12:00:00Z' }], 'America/Sao_Paulo');
    expect(g.map((x) => [x.dia, x.itens.length])).toEqual([['2026-11-10', 2], ['2026-11-11', 1]]);
  });
});

describe('agenda: tempo real e rotas', () => {
  it('evento de agendamento invalida o detalhe, as listas, os horários livres e a tela inicial', () => {
    for (const tipo of ['agenda.agendamento.criado', 'agenda.agendamento.atualizado']) {
      expect(invalidacoesPara({ id: 'e', tipo, ocorridoEm: '', dados: { agendamentoId: 'agd_1' } }))
        .toEqual([['agendamento', 'agd_1'], ['agendamentos'], ['agenda-horarios'], ['inicio']]);
    }
  });
  it('destino de notificação abre o detalhe; atalho de nova consulta aceita o paciente', () => {
    expect(caminhoDe('agenda.detalhe', { agendamentoId: 'agd_1' })).toBe('/agenda/agd_1');
    expect(caminhoDe('agenda.novo', { pacienteId: 'pac_1' })).toBe('/agenda/novo?pacienteId=pac_1');
    expect(caminhoDe('agenda.marcar')).toBe('/agenda/marcar');
  });
});
