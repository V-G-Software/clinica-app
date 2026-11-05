// Fluxo de arquivo até DISPONIVEL, rejeição por conteúdo, limites e isolamento.
import { describe, expect, it } from 'vitest';
import { type Cliente, esperar } from '../src/cliente.ts';
import { ambiente } from '../src/contexto.ts';
import { gerarPng } from '../src/png.ts';

const { api, pacienteA, pacienteB } = ambiente();

export async function enviarArquivo(api: Cliente, token: string, bytes: Buffer, tipo = 'image/png', finalidade = 'CHECKIN') {
  const ini = esperar(await api.chamar('POST', '/v1/arquivos', { token, idempotencia: true, body: { nome: 'foto.png', tipo, tamanhoBytes: bytes.length, finalidade } }), 201).body;
  const up = await fetch(ini.envio.url, { method: ini.envio.metodo, headers: ini.envio.cabecalhos, body: new Uint8Array(bytes) });
  expect(up.ok, `envio dos bytes para envio.url: HTTP ${up.status}`).toBe(true);
  esperar(await api.chamar('POST', `/v1/arquivos/${ini.arquivoId}/concluir`, { token }), 200);
  const limite = Date.now() + 10_000;
  for (;;) {
    const a = esperar(await api.chamar('GET', `/v1/arquivos/${ini.arquivoId}`, { token }), 200).body;
    if (a.status === 'DISPONIVEL' || a.status === 'REJEITADO' || Date.now() > limite) return a;
    await new Promise((ok) => setTimeout(ok, 250));
  }
}

describe('arquivos', () => {
  it('imagem válida chega a DISPONIVEL com URL de visualização de até 5 minutos', async () => {
    const a = await enviarArquivo(api, pacienteA.token, gerarPng());
    expect(a.status).toBe('DISPONIVEL');
    expect(a.urlVisualizacao).toBeTruthy();
    const validade = Date.parse(a.urlsExpiramEm) - Date.parse((await api.chamar('GET', '/v1/publico/saude')).body.agora);
    expect(validade).toBeLessThanOrEqual(5 * 60_000 + 2_000);
    const img = await fetch(a.urlVisualizacao);
    expect(img.ok).toBe(true);
    esperar(await api.chamar('GET', `/v1/arquivos/${a.id}`, { token: pacienteB.token }), 404);
  });

  it('conteúdo que não corresponde ao tipo é REJEITADO', async () => {
    const a = await enviarArquivo(api, pacienteA.token, Buffer.from('isto não é uma imagem png'));
    expect(a.status).toBe('REJEITADO');
    expect(a.urlVisualizacao).toBeNull();
  });

  it('tipo não permitido e tamanho acima do limite são recusados antes do envio', async () => {
    esperar(await api.chamar('POST', '/v1/arquivos', { token: pacienteA.token, idempotencia: true, body: { nome: 'a.pdf', tipo: 'application/pdf', tamanhoBytes: 1000, finalidade: 'CHAT' } }), [415, 422], 'TIPO_ARQUIVO_NAO_PERMITIDO');
    const m = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    esperar(await api.chamar('POST', '/v1/arquivos', { token: pacienteA.token, idempotencia: true, body: { nome: 'g.png', tipo: 'image/png', tamanhoBytes: m.capacidades.upload.tamanhoMaximoBytes + 1, finalidade: 'CHAT' } }), [413, 422], 'ARQUIVO_MUITO_GRANDE');
  });
});
