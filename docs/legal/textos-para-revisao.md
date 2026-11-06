# Textos de alerta e de urgência: revisão obrigatória antes do piloto (decisão 9)

> Cada texto abaixo aparece para pacientes ou orienta a equipe. Precisa de **revisão por profissional de saúde da área E por advogado**.
> Os textos dos cenários são exemplos: a clínica do piloto define os dela (configuração da organização e protocolos) e eles também entram nesta lista.
> Quem revisar assina na última coluna.

## Aviso de urgência fixo no topo da conversa do paciente
| Organização | Texto | Revisão clínica | Revisão jurídica |
|---|---|---|---|
| modelo-otorrino | Em caso de sangramento intenso, falta de ar ou febre alta, procure um pronto-socorro ou ligue 192. | | |
| fisio-movimento | Dor súbita e intensa, formigamento novo ou perda de força: procure atendimento de urgência. | | |
| vet-amigo | Sangramento, pontos abertos, vômitos repetidos ou apatia: procure o plantão veterinário 24 h. | | |

## Resposta automática fora do horário
| Organização | Texto | Revisão |
|---|---|---|
| modelo-otorrino | Recebemos sua mensagem. A equipe responde de segunda a sexta, das 8h às 18h. | |
| fisio-movimento | Recebemos sua mensagem e respondemos no próximo horário de atendimento. | |
| vet-amigo | Recebemos sua mensagem. Respondemos no próximo horário de atendimento. | |

Pergunta para o advogado: a resposta fora do horário deveria repetir o aviso de urgência? Hoje ela não repete, e o aviso fica fixo no topo da conversa.

## Regras de alerta (o limiar é decisão clínica; a equipe vê a mensagem)
| Protocolo | Regra | Severidade | Condição | Mensagem | Revisão clínica |
|---|---|---|---|---|---|
| Septoplastia 7 dias | dor_alta | ALTA | dor ≥ 8 | Dor 8 ou mais relatada | |
| Septoplastia 7 dias | sangramento_intenso | ALTA | sangramento = INTENSO | Sangramento intenso relatado | |
| Septoplastia 7 dias | febre | MEDIA | temperatura ≥ 38 | Temperatura de 38 °C ou mais | |
| Septoplastia 7 dias | sem_resposta | MEDIA | check-in expirou | Check-in não respondido | |
| Rinoplastia 10 dias | dor_alta / sangramento_intenso / sem_resposta | ALTA / ALTA / MEDIA | idem | idem | |
| Lombalgia 14 dias | dor_alta | MEDIA | dor ≥ 7 | Dor 7 ou mais durante os exercícios | |
| Lombalgia 14 dias | formigamento | ALTA | sintomas contém FORMIGAMENTO | Formigamento relatado | |
| Lombalgia 14 dias | nao_fez / sem_registro | BAIXA | não fez exercícios / expirou | … | |
| Castração 10 dias | pontos_abertos | ALTA | ferida = ABERTA | Pontos abertos relatados | |
| Castração 10 dias | secrecao / sem_apetite | MEDIA | ferida = SECRECAO / apetite = NADA | … | |

## Orientações publicadas na conversa no dia programado
| Protocolo | Dia | Texto | Revisão clínica |
|---|---|---|---|
| Septoplastia | 0 | Mantenha a cabeceira elevada e evite assoar o nariz. | |
| Septoplastia | 3 | Hoje começam as lavagens nasais com soro, 3 vezes ao dia. | |
| Rinoplastia | 0 | Mantenha compressas frias nas primeiras 48 horas e a cabeceira elevada. | |
| Rinoplastia | 7 | Retorno para retirada do curativo conforme agendado com a secretária. | |
| Lombalgia | 0 | Faça os exercícios em superfície firme e pare se a dor passar de 7. | |
| Lombalgia | 7 | A partir de hoje, aumente para 3 séries de cada exercício. | |
| Castração | 0 | Mantenha o colar elizabetano o tempo todo e ofereça água à vontade. | |
| Castração | 10 | Hoje é o dia da retirada dos pontos. Confirme o horário com a recepção. | |

## Textos fixos do sistema (push e e-mail discretos, `backend/src/servicos/notificar.ts`)
"Você tem uma nova mensagem" · "Seu check-in de hoje está disponível" · "Lembrete: seu check-in ainda não foi respondido" · "Há um novo alerta para revisar" · "Seu acompanhamento foi iniciado" · "Seu acompanhamento foi concluído". Todos seguidos de "— {organização}.".
Verificar se o nome da clínica na tela bloqueada já revela informação sensível (ex.: clínica especializada).
