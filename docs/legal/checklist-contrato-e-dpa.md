# Contrato com a clínica e acordo de tratamento de dados: cláusulas mínimas

> Checklist para o advogado redigir. Cada item corresponde a um comportamento que o sistema já tem (ou não). O contrato não pode prometer o que o sistema não faz.

**Papéis e instruções**
- [ ] Clínica = controladora; plataforma = operadora; tratamento só por instrução documentada (art. 39).
- [ ] Finalidade limitada ao acompanhamento e à comunicação assistencial. Sem uso para marketing, sem venda, sem treinar modelos com os dados.

**Segurança (art. 46): anexo técnico com o que existe**
- [ ] Isolamento por organização (RLS forçado), MFA para a equipe, criptografia em trânsito (TLS) e em repouso (provedor), trilha de auditoria, backups com PITR e ensaio de restauração.

**Suboperadores**
- [ ] Lista anexa ([subprocessadores.md](subprocessadores.md)), aviso prévio de troca e direito de objeção.

**Incidentes (art. 48)**
- [ ] A plataforma avisa a clínica sem demora injustificada. Sugestão: até 24 h depois de confirmar o incidente, para que a clínica cumpra o prazo da ANPD (3 dias úteis pela Resolução CD/ANPD nº 15/2024; confirmar com o advogado).
- [ ] Conteúdo mínimo da comunicação, conforme o modelo em [../operacao/incidente.md](../operacao/incidente.md).

**Direitos dos titulares**
- [ ] A plataforma apoia a clínica: exportação, relatório de acessos (`pnpm incidente acessos`) e exclusão de conta.

**Retenção e devolução**
- [ ] O que acontece no fim do contrato: exportação para a clínica e prazo de eliminação ou guarda, respeitando a guarda de prontuário. **[DECIDIR]**
- [ ] Hoje o sistema não apaga dado clínico (14.5). A eliminação no fim do contrato é um procedimento operacional que ainda precisa ser escrito.

**Responsabilidade clínica**
- [ ] O app não é canal de emergência. Alertas são informativos (RN-ACO-005): a decisão clínica e o horário de atendimento são da clínica.
- [ ] A clínica revisa os textos de urgência e as regras de alerta dos seus protocolos.

**Auditoria**
- [ ] A clínica pode pedir relatório de acessos e evidências de segurança (resultados do CI e do ensaio de restauração).
