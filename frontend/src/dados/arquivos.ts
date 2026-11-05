// Envio de arquivos (8.3): reduzir no aparelho → POST /v1/arquivos → bytes para envio.url
// (sem Authorization: a URL já é assinada) → /concluir → aguardar DISPONIVEL ou REJEITADO.
import type { Arquivo } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';

const LADO_MAXIMO = 2048;

/** Reduz para JPEG 0,85 com lado máximo de 2048 px (economiza dados móveis). Sem suporte, devolve o original. */
export async function reduzirImagem(arquivo: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(arquivo.type) || typeof createImageBitmap === 'undefined') return arquivo;
  try {
    const bmp = await createImageBitmap(arquivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bmp.width, bmp.height));
    if (escala === 1 && arquivo.type === 'image/jpeg' && arquivo.size < 1_500_000) return arquivo;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala); canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    return blob && blob.size < arquivo.size ? blob : arquivo;
  } catch { return arquivo; }
}

function enviarBytes(url: string, metodo: string, cabecalhos: Record<string, string>, corpo: Blob, aoProgresso?: (p: number) => void, sinal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(metodo, url);
    for (const [k, v] of Object.entries(cabecalhos)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && aoProgresso?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ErroApi(xhr.status, 'ARQUIVO_REJEITADO', null)));
    xhr.onerror = () => reject(new ErroApi(0, 'REDE', null));
    sinal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new DOMException('cancelado', 'AbortError'));
    xhr.send(corpo);
  });
}

export async function enviarArquivo(arquivo: File, finalidade: 'CHECKIN' | 'CHAT' | 'PERFIL' | 'ORGANIZACAO', opcoes: { aoProgresso?: (p: number) => void; sinal?: AbortSignal } = {}): Promise<Arquivo> {
  const blob = await reduzirImagem(arquivo);
  const tipo = blob.type || arquivo.type;
  const nome = arquivo.name.replace(/\.(heic|heif|png|webp)$/i, tipo === 'image/jpeg' ? '.jpg' : '$&');
  const ini = await ok(api().POST('/v1/arquivos', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { nome, tipo, tamanhoBytes: blob.size, finalidade },
  }));
  await enviarBytes(ini.envio.url, ini.envio.metodo, ini.envio.cabecalhos, blob, opcoes.aoProgresso, opcoes.sinal);
  await ok(api().POST('/v1/arquivos/{arquivoId}/concluir', { params: { path: { arquivoId: ini.arquivoId } } }));
  const limite = Date.now() + 15_000;
  for (;;) {
    const a = await ok(api().GET('/v1/arquivos/{arquivoId}', { params: { path: { arquivoId: ini.arquivoId } } }));
    if (a.status === 'DISPONIVEL') return a;
    if (a.status === 'REJEITADO') throw Object.assign(new ErroApi(422, 'ARQUIVO_REJEITADO', null), { detalhe: a.motivoRejeicao ?? undefined });
    if (Date.now() > limite) throw new ErroApi(0, 'INDISPONIVEL_TEMPORARIAMENTE', null);
    await new Promise((r) => setTimeout(r, 700));
  }
}
