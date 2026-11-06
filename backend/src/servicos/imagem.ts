// Validação e higiene de imagem (8.3 / 14.4, QUESTION-022 resolvida na F3):
//  1. assinatura do tipo (magic bytes) — barra arquivo com extensão/Content-Type mentiroso;
//  2. DECODIFICA e RECODIFICA com sharp (libvips): o arquivo guardado é gerado do zero a partir dos
//     pixels — metadados (EXIF com GPS, XMP, IPTC, ICC), comentários, chunks desconhecidos e conteúdo
//     anexado ao fim do arquivo (poliglotas JPEG+ZIP/HTML) não sobrevivem;
//  3. orientação EXIF aplicada antes (a foto não "deita" ao perder o EXIF);
//  4. lado maior limitado a 2560 px e miniatura de 320 px para listas (urlMiniatura).
// Imagem que não decodifica (corrompida, bomba de descompressão acima do limite) é rejeitada.
import sharp from 'sharp';

export const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};

const LADO_MAXIMO = 2560;
const LADO_MINIATURA = 320;
const PIXELS_MAXIMOS = 50_000_000; // ~ 7000×7000: acima disso é suspeita de bomba de descompressão

sharp.cache(false); // processo de longa duração: não segura memória entre uploads
sharp.concurrency(1);

function codificar(img: sharp.Sharp, tipo: string) {
  if (tipo === 'image/png') return img.png({ compressionLevel: 9 });
  if (tipo === 'image/webp') return img.webp({ quality: 85 });
  return img.jpeg({ quality: 85, mozjpeg: true });
}

export interface ImagemProcessada { imagem: Buffer; miniatura: Buffer; largura: number; altura: number }

/** Recodifica a imagem e gera a miniatura, no MESMO formato declarado. Lança se não decodificar. */
export async function recodificar(tipo: string, bytes: Buffer): Promise<ImagemProcessada> {
  const base = () => sharp(bytes, { limitInputPixels: PIXELS_MAXIMOS, failOn: 'error', animated: false }).rotate();
  const { data: imagem, info } = await codificar(base().resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true }), tipo).toBuffer({ resolveWithObject: true });
  const miniatura = await codificar(base().resize({ width: LADO_MINIATURA, height: LADO_MINIATURA, fit: 'inside', withoutEnlargement: true }), tipo).toBuffer();
  return { imagem, miniatura, largura: info.width, altura: info.height };
}
