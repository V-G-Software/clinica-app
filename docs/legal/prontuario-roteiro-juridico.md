# Prontuário eletrônico: roteiro de perguntas para o jurídico

Objetivo: obter o parecer que falta para o módulo `prontuario` ([ADR-0019](../adr/0019-modulo-prontuario.md)). O desenho técnico já é conservador: nada se apaga, há correção por adendo, autoria e data em tudo, acesso só do profissional, auditoria de leitura e cópia ao paciente sob pedido. As perguntas abaixo definem o que ainda muda.

Para cada pergunta: a hipótese adotada no produto até o parecer e o que muda conforme a resposta.

## 1. Assinatura e validade jurídica
1. **Sem assinatura ICP-Brasil, o prontuário do app tem valor jurídico?** Ou a clínica precisa manter o prontuário oficial em papel ou em outro sistema certificado? (CFM 1.821/2007: dispensar o papel exige ICP-Brasil e NGS2.)
   - *Hipótese:* registro imutável com autoria (login, MFA, data e hora). O app avisa que a clínica segue o procedimento dela para o prontuário oficial.
   - *Se a assinatura for exigida:* reaproveitamos o fluxo de certificado em nuvem da receita (ADR-0018) para assinar evoluções em lote.
2. **A certificação SBIS/CFM (NGS1/NGS2) é obrigatória para o software, ou só para dispensar o papel?** O que muda no contrato com a clínica se o app não for certificado?

## 2. Guarda e eliminação
3. **Prazo de guarda.** Lei 13.787/2018: 20 anos a partir do último registro. Isso vale para:
   - (a) o prontuário em si;
   - (b) check-ins do pós-operatório e conversas do chat (fazem parte do prontuário? QUESTION-015);
   - (c) o log de acesso (quem leu).
4. **Prontuário veterinário (CFMV 1.321/2020):** qual o prazo?
5. **Fim do contrato com a clínica:** quem guarda pelo restante do prazo? Exportar tudo para a clínica e eliminar do nosso lado é aceitável? Em que formato (PDF por paciente, dados estruturados)?
6. **Paciente que pede exclusão (LGPD art. 18):** confirmar que o prontuário fica retido por obrigação legal (art. 16, I) e que só o acesso dele ao app é removido.

## 3. Acesso e sigilo
7. **Quem da equipe pode ler.**
   - *Hipótese:* só profissionais de saúde.
   - A secretaria não lê. O gestor que não é profissional só vê o log de acesso.
   - Está adequado ao sigilo (CFM 1.638/2002, Código de Ética Médica, art. 85)?
8. **Profissional de outra especialidade na mesma clínica** (por exemplo, a fisioterapeuta parceira) pode ler tudo ou só o que é da área dele?
9. **O log de acesso precisa ser mostrado ao paciente quando ele pedir?**

## 4. Cópia ao paciente (LGPD art. 19 e CFM)
10. **Prazo:** 15 dias para a cópia completa está correto? Há prazo menor pelo CFM?
11. **Quem pode pedir:**
    - o próprio paciente;
    - o responsável legal de menor;
    - o tutor do animal;
    - o curador.
    Precisa de verificação extra de identidade além do login com código por e-mail?
12. **Pode haver recusa ou entrega parcial** (por exemplo, informação que possa causar dano ao paciente)? Em que termos?
13. **A cópia deve ser assinada** (ICP) para valer perante terceiros, por exemplo perícia ou outro médico?

## 5. Conteúdo
14. **Conteúdo mínimo obrigatório** (CFM 1.638/2002, art. 5º): identificação do paciente, anamnese, exame físico, hipóteses diagnósticas, diagnóstico definitivo, tratamento e evolução diária com data, hora e identificação do profissional. Os modelos por especialidade precisam cobrir tudo isso obrigatoriamente, ou é responsabilidade do profissional?
15. **CID na lista de problemas:** há restrição de uso dentro do prontuário? A restrição de autorização vale para o atestado, não para o registro interno.
16. **Hora do registro:** a hora do servidor é suficiente ou é preciso carimbo de tempo (ACT ICP-Brasil)?

## 6. Contrato e DPA
17. **Responsabilidades:**
    - a clínica é controladora e nós operadores?
    - quem responde pelo conteúdo clínico e quem pela integridade e disponibilidade?
    - redação para o `checklist-contrato-e-dpa.md`.
18. **Incidente envolvendo prontuário:** prazos e comunicação (ANPD, titulares e CRM) além do que já está em `docs/operacao/incidente.md`.

## Como responder
Para cada número, basta um parágrafo com a resposta e a base legal. Itens com resposta "depende" devem dizer do quê. As respostas viram QUESTIONs decididas e, quando mudarem o produto, ajustes na ADR-0019.
