// Menu do manifesto (7.1): só telas de módulos ativos, rótulos prontos a partir dos termos.
import { configModulo, type ModuloAtivo } from './permissoes.ts';
import { cap, flex, type Termo } from './termos.ts';

export interface ItemNavegacao { id: string; rotulo: string; icone: string; grupo: 'PRINCIPAL' | 'SECUNDARIO'; destino: { tela: string }; contador?: string }

export function montarNavegacao(o: { equipe: boolean; permissoes: Set<string>; modulos: ModuloAtivo[]; termos: Record<string, Termo> }): ItemNavegacao[] {
  const { permissoes: p, termos: t } = o;
  const itens: ItemNavegacao[] = [{ id: 'inicio', rotulo: 'Início', icone: 'house', grupo: 'PRINCIPAL', destino: { tela: 'inicio' } }];
  const animal = (configModulo(o.modulos, 'pacientes').relacoesPermitidas ?? []).every((r: string) => r === 'ANIMAL');
  if (o.equipe) {
    if (p.has('acompanhamento.acompanhamento.ler'))
      itens.push({ id: 'acompanhamentos', rotulo: cap(t.acompanhamento.plural), icone: 'activity', grupo: 'PRINCIPAL', destino: { tela: 'acompanhamento.lista' }, ...(p.has('acompanhamento.alerta.ler') ? { contador: 'acompanhamento.alertasAbertos' } : {}) });
    if (p.has('chat.conversa.ler')) itens.push({ id: 'conversas', rotulo: cap(t.conversa.plural), icone: 'message-circle', grupo: 'PRINCIPAL', destino: { tela: 'chat.lista' }, contador: 'chat.naoLidas' });
    if (p.has('pacientes.paciente.ler')) itens.push({ id: 'pacientes', rotulo: cap(t.paciente.plural), icone: animal ? 'paw-print' : 'users', grupo: 'PRINCIPAL', destino: { tela: 'pacientes.lista' } });
    itens.push({ id: 'notificacoes', rotulo: 'Notificações', icone: 'bell', grupo: 'SECUNDARIO', destino: { tela: 'notificacoes' }, contador: 'notificacoes.naoLidas' });
    if (p.has('acompanhamento.protocolo.ler')) itens.push({ id: 'protocolos', rotulo: cap(t.protocolo.plural), icone: 'clipboard-list', grupo: 'SECUNDARIO', destino: { tela: 'acompanhamento.protocolos' } });
    if (p.has('equipe.membro.gerenciar')) itens.push({ id: 'equipe', rotulo: 'Equipe', icone: 'stethoscope', grupo: 'SECUNDARIO', destino: { tela: 'equipe.lista' } });
    if (p.has('organizacao.configuracao.editar')) itens.push({ id: 'organizacao', rotulo: `Configurações ${flex(t.organizacao, 'do', 'da')} ${t.organizacao.singular}`, icone: 'settings', grupo: 'SECUNDARIO', destino: { tela: 'organizacao.configuracao' } });
  } else {
    const a = t.acompanhamento;
    if (p.has('acompanhamento.acompanhamento.ler')) itens.push({ id: 'meus-acompanhamentos', rotulo: `${flex(a, 'Meu', 'Minha')} ${a.singular}`, icone: 'heart-pulse', grupo: 'PRINCIPAL', destino: { tela: 'acompanhamento.meus' }, contador: 'acompanhamento.checkinsPendentes' });
    if (p.has('chat.conversa.ler')) itens.push({ id: 'conversas', rotulo: cap(t.conversa.plural), icone: 'message-circle', grupo: 'PRINCIPAL', destino: { tela: 'chat.lista' }, contador: 'chat.naoLidas' });
    itens.push({ id: 'notificacoes', rotulo: 'Notificações', icone: 'bell', grupo: 'PRINCIPAL', destino: { tela: 'notificacoes' }, contador: 'notificacoes.naoLidas' });
  }
  itens.push({ id: 'perfil', rotulo: 'Meu perfil', icone: 'user', grupo: o.equipe ? 'SECUNDARIO' : 'PRINCIPAL', destino: { tela: 'perfil' } });
  return itens;
}
