// Verificação em tempo de compilação: se o contrato mudar de forma incompatível, este arquivo
// deixa de compilar (`pnpm -r typecheck`). Não é importado em runtime.
import { criarClienteContrato, novaChaveIdempotencia } from './index.ts';

export async function exemplo() {
  const api = criarClienteContrato({ urlApi: 'http://localhost:4010/o/modelo-otorrino', token: () => 'x' });
  const { data } = await api.GET('/v1/sessao', {});
  const telas: string[] = data?.navegacao.map((n) => n.destino.tela) ?? [];
  const r = await api.POST('/v1/checkins/{checkinId}/respostas', {
    params: { path: { checkinId: 'chk_1' }, header: { 'Idempotency-Key': novaChaveIdempotencia() } },
    body: { respostas: { dor: 6, sangramento: 'LEVE', foto: ['arq_1'] } },
  });
  // @ts-expect-error — tipo errado no corpo deve falhar na compilação
  await api.POST('/v1/auth/entrar', { body: { email: 'a@b.c', senha: 123 } });
  // @ts-expect-error — caminho fora do contrato deve falhar na compilação
  await api.GET('/v1/rota-que-nao-existe', {});
  return { telas, status: r.response.status };
}
