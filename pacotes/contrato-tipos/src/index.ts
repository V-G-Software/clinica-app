// Tipos derivados do contrato. `openapi.d.ts` é GERADO por `pnpm contrato:gerar`; não edite à mão.
import type { components, operations, paths } from './openapi.d.ts';

export type { components, operations, paths };
type S = components['schemas'];

export type Manifesto = S['Manifesto'];
export type ConfiguracaoPublica = S['ConfiguracaoPublica'];
export type OrganizacaoDiretorio = S['OrganizacaoDiretorio'];
export type RespostaEtapa = S['RespostaEtapa'];
export type Problema = S['Problema'];
export type Evento = S['Evento'];
export type Secao = S['Secao'];
export type Paciente = S['Paciente'];
export type PacienteEntrada = S['PacienteEntrada'];
export type ProtocoloEntrada = S['ProtocoloEntrada'];
export type Usuario = S['Usuario'];
export type Formulario = S['Formulario'];
export type CampoFormulario = S['CampoFormulario'];
export type Protocolo = S['Protocolo'];
export type Acompanhamento = S['Acompanhamento'];
export type Checkin = S['Checkin'];
export type Alerta = S['Alerta'];
export type Conversa = S['Conversa'];
export type Mensagem = S['Mensagem'];
export type Notificacao = S['Notificacao'];
export type Arquivo = S['Arquivo'];
export type Membro = S['Membro'];
export type Servico = S['Servico'];
export type Grade = S['Grade'];
export type Bloqueio = S['Bloqueio'];
export type HorarioLivre = S['HorarioLivre'];
export type Agendamento = S['Agendamento'];
export type AgendamentoResumo = S['AgendamentoResumo'];
export type ConfigAgenda = S['ConfigAgenda'];

// Catálogos fechados (7.2). O frontend ignora valores fora deles (compatibilidade para frente).
export type Perfil = S['Perfil'];
export type Tela = S['Tela'];
export type TipoSecao = S['TipoSecao'];
export type TipoEvento = S['TipoEvento'];
export type CodigoErro = S['CodigoErro'];
export type Permissao = S['Permissao'];
export type Icone = S['Icone'];
