# Frontend — PWA único

Construído a partir de `docs/PROMPT_FRONTEND.md`, sobre o contrato (`@clinica/contrato-cliente`) e o mock.

```bash
pnpm mock                          # http://localhost:4010
pnpm --filter frontend dev         # http://localhost:5173/?org=modelo-otorrino
pnpm --filter frontend test        # unitários (Vitest)
pnpm --filter frontend e2e         # E2E FE0–FE4 com Playwright (mock e dev server no ar)
pnpm --filter frontend e2e:a11y    # auditoria de acessibilidade (axe-core)
pnpm --filter frontend build:homologacao && pnpm --filter frontend preview:homologacao  # produção + CSP em :4173
pnpm --filter frontend e2e:csp     # fluxos com a CSP ativa
pnpm --filter frontend build       # build de produção + service worker
```

Em desenvolvimento, `?org=` escolhe a organização (fica lembrado) e o botão de chave inglesa troca de organização e avança o relógio do mock. Logins de teste: `mock/README.md`.

## Estado

### F4 · agenda (ADR-0016)
| Critério de saída | Situação |
|---|---|
| Equipe: agenda do dia e da semana, marcar (horário livre ou fora da grade), encaixe, remarcar, cancelar, realizar, falta | `e2e/fe4.mjs` |
| Conflito 409 `HORARIO_INDISPONIVEL` tratado (sugere encaixe à equipe; paciente escolhe outro horário) | `e2e/fe4.mjs` |
| Gestor: serviços (arquivar não apaga), grade semanal com If-Match, bloqueios da organização e do profissional, configuração da agenda | `e2e/fe4.mjs` |
| Paciente: "Próxima consulta" no início, confirmar presença, marcar sozinho, cancelar dentro do prazo | `e2e/fe4.mjs` |
| Sem autoagendamento (vet) e sem o módulo (fisio): rota bloqueada e nada no menu | `e2e/fe4.mjs` |
| Datas no fuso da organização, não do aparelho | `e2e/fe4.mjs` roda com o aparelho em Tóquio; `tests/unit/agenda.test.ts` cobre a conversão e o horário de verão |
| Troca do mock para o backend real só pelo endereço do diretório | `e2e/backend-real.mjs` (marca, paciente confirma, equipe vê em tempo real) |
| Cirurgia ↔ pós-operatório (RN-AGE-008): nasce junto (protocolo sugerido), remarcar para outro dia recria, cancelar encerra; avisos nos diálogos | `e2e/fe4.mjs` |
| Acessibilidade | `e2e/acessibilidade.mjs` inclui as 8 telas da agenda: zero violações graves |

Barra inferior no celular: no máximo 5 posições **contando o "Mais"**. Quando há itens secundários, o 5º item principal do manifesto desce para o "Mais". Cinco rótulos longos ("Meu pós-operatório", "Minhas consultas") não cabem em 360 px.

### FE3 · pronto para o piloto: critérios técnicos concluídos
| Critério de saída | Situação |
|---|---|
| E2E 11: acessibilidade | `e2e/acessibilidade.mjs`: 86 telas, zero violações (axe-core, WCAG 2.2 AA) |
| Orçamentos de desempenho | JS inicial 84 KB gzip (meta 170 KB); paciente não baixa telas da equipe (`e2e/fe3.mjs`). LCP em celular real: **pendente** (precisa de build publicado) |
| Segurança (CSP, scrubbing) | CSP estrita validada no build de produção (`e2e/csp.mjs`); erros sem dado pessoal (ADR-0012) |
| Estados vazios e de erro revisados | `EstadoConsulta` nas listas e no início: esqueleto, erro com "tentar de novo" e código de suporte, vazio com o termo do domínio |
| Revisão de textos com a clínica piloto | **pendente** (humano) |
| Troca para o backend real mudando só `VITE_DIRETORIO_URL` | **pendente**: depende do backend F1–F2 |


### FE2 · equipe: concluída
| Critério de saída | Como foi verificado |
|---|---|
| E2E 1: três marcas, claro e escuro | `e2e/fe2.mjs` (capturas por organização e esquema; `modoPadrao` respeitado) |
| E2E 3: equipe vê o alerta chegar sem recarregar e resolve | `e2e/fe2.mjs` |
| E2E 7: tutora alterna entre pets e recebe mensagem por polling | `e2e/fe2.mjs` (vet-amigo, intervalo de 15 s) |
| E2E 8: conflito 412 tratado | `e2e/fe2.mjs` (duas sessões editando o mesmo paciente) |
| E2E 10: duas abas | `e2e/fe0.mjs` e `e2e/fe2.mjs` |
| Nenhum `if` por organização | `e2e/fe2.mjs` varre `src/` atrás de slugs e nomes dos cenários |

Telas: pacientes (lista, busca pelo corpo, cadastro de pessoa ou animal com campos adicionais, detalhe, edição com If-Match, convite com QR), acompanhamentos (lista com filtros, novo com prévia dos dias, alertas e resolução, encerramento, equipe e observação), protocolos (lista, editor que publica nova versão), conversas da equipe (participantes, arquivar, reabrir), equipe (convite, perfis, suspender, desligar) e configurações da organização (marca com prévia e contraste, logo, textos, horário do chat).

### FE1 · login e paciente: concluída
| Critério de saída | Como foi verificado |
|---|---|
| E2E 2: paciente responde o check-in, vê a confirmação e não vê o alerta | `e2e/fe1.mjs` |
| E2E 4: relógio +1 dia, renovação sem login, dia 4 aparece | `e2e/fe1.mjs` |
| E2E 5: convite + onboarding | `e2e/fe1.mjs` (Paulo) |
| E2E 6: primeiro acesso da equipe | `e2e/fe1.mjs` (Carlos) |
| E2E 9: mensagem offline reenviada sem duplicar | `e2e/fe1.mjs` |
| Teste manual em iPhone real instalado (push chegando) | **pendente**: precisa de build publicado em HTTPS e chave VAPID real |

Também no E2E: alerta e mensagem chegam à equipe em tempo real, sem recarregar.

Telas: início do paciente, meus acompanhamentos (com seletor de pet), detalhe com linha do tempo, check-in passo a passo com fotos, conversas (envio otimista, fila offline, fotos, aviso de urgência, fora do horário, leitura), notificações, perfil (tema, densidade, notificações por tipo, push, sair de todos, excluir conta), convite e onboarding. Tempo real com SSE/polling e aba líder.

### FE0 · esqueleto: concluída
As 3 organizações com marca própria e o menu vindo do manifesto (`e2e/fe0.mjs`).

## Estrutura
```text
src/app/         descoberta, inicialização (3 camadas), marca/cores, versão
src/api/         cliente do contrato, renovação single-flight entre abas, erros RFC 9457
src/sessao/      store de sessão (token só em memória) e menu do manifesto
src/catalogo/    catálogo fixo de telas e ícones
src/i18n/        vue-i18n (textos da UI) + termos do domínio + datas no fuso da organização
src/ds/          design system base (tokens da marca em runtime)
src/telas/       telas do catálogo
src/pwa/         service worker, registro, manifest web e push
src/tempo-real/  SSE/polling, aba líder, evento → invalidação
src/dados/       cache de consultas, mensagens, envio de arquivos
borda/           função de borda: manifest e cabeçalhos de segurança (CSP) por organização
src/observabilidade/ registro de erros com limpeza de dado pessoal
```
