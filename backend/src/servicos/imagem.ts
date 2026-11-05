// Validação e higiene de imagem (8.3 / 14.4): confere a assinatura do tipo (magic bytes) e remove
// metadados EXIF/XMP, que podem conter a localização do paciente. A recodificação completa (que também
// neutraliza payloads escondidos nos pixels) exige uma biblioteca nativa de imagem: QUESTION-022.
export const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};

/** JPEG: remove segmentos APP1 (EXIF/XMP), APP13 (IPTC) e comentários. */
function limparJpeg(b: Buffer): Buffer {
  const partes: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marcador = b[i + 1];
    if (marcador === 0xda) { partes.push(b.subarray(i)); return Buffer.concat(partes); } // início dos dados da imagem
    const tam = b.readUInt16BE(i + 2);
    const seg = b.subarray(i, i + 2 + tam);
    if (!(marcador === 0xe1 || marcador === 0xed || marcador === 0xfe)) partes.push(seg);
    i += 2 + tam;
  }
  return Buffer.concat([...partes, b.subarray(i)]);
}
/** PNG: remove chunks eXIf, tEXt, zTXt, iTXt e tIME. */
function limparPng(b: Buffer): Buffer {
  const partes: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const tam = b.readUInt32BE(i);
    const tipo = b.subarray(i + 4, i + 8).toString('latin1');
    const chunk = b.subarray(i, i + 12 + tam);
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(tipo)) partes.push(chunk);
    i += 12 + tam;
    if (tipo === 'IEND') break;
  }
  return Buffer.concat(partes);
}
/** WebP: remove chunks EXIF e XMP e ajusta o tamanho RIFF. */
function limparWebp(b: Buffer): Buffer {
  const partes: Buffer[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const tipo = b.subarray(i, i + 4).toString('latin1');
    const tam = b.readUInt32LE(i + 4);
    const total = 8 + tam + (tam % 2);
    if (tipo !== 'EXIF' && tipo !== 'XMP ') partes.push(b.subarray(i, i + total));
    i += total;
  }
  const corpo = Buffer.concat(partes);
  const cab = Buffer.from(b.subarray(0, 12));
  cab.writeUInt32LE(corpo.length + 4, 4);
  return Buffer.concat([cab, corpo]);
}
export function higienizar(tipo: string, b: Buffer): Buffer {
  if (tipo === 'image/jpeg') return limparJpeg(b);
  if (tipo === 'image/png') return limparPng(b);
  if (tipo === 'image/webp') return limparWebp(b);
  return b;
}
