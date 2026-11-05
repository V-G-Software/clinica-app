import { describe, expect, it } from 'vitest';
import { camposVisiveis, lerNumero, limparRespostas, validarCampo, validarTudo } from '@/ds/formulario/regras';

const campos: any[] = [
  { id: 'dor', tipo: 'ESCALA', rotulo: 'Dor', min: 0, max: 10, obrigatorio: true },
  { id: 'mediu', tipo: 'SIM_NAO', rotulo: 'Mediu?', obrigatorio: true },
  { id: 'temperatura', tipo: 'NUMERO', rotulo: 'Temp', min: 34, max: 43, casasDecimais: 1, obrigatorio: true, visivelSe: { campo: 'mediu', operador: 'IGUAL', valor: true } },
  { id: 'sintomas', tipo: 'ESCOLHA_MULTIPLA', rotulo: 'Sintomas', opcoes: [{ valor: 'A', rotulo: 'A' }], obrigatorio: false },
  { id: 'aviso', tipo: 'INFORMACAO', rotulo: 'Leia' },
  { id: 'futuro', tipo: 'ASSINATURA', rotulo: 'Campo de versão futura', obrigatorio: false },
];

describe('formulário dinâmico', () => {
  it('visivelSe esconde e mostra campos', () => {
    expect(camposVisiveis(campos, { mediu: false }).map((c) => c.id)).not.toContain('temperatura');
    expect(camposVisiveis(campos, { mediu: true }).map((c) => c.id)).toContain('temperatura');
  });
  it('remove valor de campo oculto, vazios e INFORMACAO antes de enviar', () => {
    expect(limparRespostas(campos, { dor: 3, mediu: false, temperatura: 39, sintomas: [], aviso: 'x' })).toEqual({ dor: 3, mediu: false });
  });
  it('obrigatório só quando visível', () => {
    expect(validarTudo(campos, { dor: 2, mediu: false })).toEqual({});
    expect(validarTudo(campos, { dor: 2, mediu: true })).toHaveProperty('temperatura');
  });
  it('intervalo e casas decimais', () => {
    expect(validarCampo(campos[0], 11)).toMatch(/entre 0 e 10/);
    expect(validarCampo(campos[2], 37.55)).toMatch(/casa/);
    expect(validarCampo(campos[2], 37.5)).toBeNull();
  });
  it('tipo desconhecido opcional não bloqueia; obrigatório pede atualização', () => {
    expect(validarCampo(campos[5], undefined)).toBeNull();
    expect(validarCampo({ ...campos[5], obrigatorio: true }, undefined)).toMatch(/Atualize/);
  });
  it('número com vírgula', () => { expect(lerNumero('37,5')).toBe(37.5); expect(lerNumero('')).toBeUndefined(); expect(lerNumero('abc')).toBeNaN(); });
});

import { dentroDoHorario } from '@/telas/chat/horario';
describe('horário de atendimento no fuso da organização', () => {
  const seg = [{ diaSemana: 1, inicio: '08:00', fim: '18:00' }];
  it('segunda 10:30 em São Paulo (13:30Z) está dentro', () => expect(dentroDoHorario(seg, Date.parse('2026-11-09T13:30:00Z'), 'America/Sao_Paulo')).toBe(true));
  it('segunda 19:00 em São Paulo (22:00Z) está fora', () => expect(dentroDoHorario(seg, Date.parse('2026-11-09T22:00:00Z'), 'America/Sao_Paulo')).toBe(false));
  it('sem horário configurado: sempre dentro', () => expect(dentroDoHorario([], 0, 'UTC')).toBe(true));
});
