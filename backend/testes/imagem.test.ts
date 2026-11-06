// Higiene de imagem (14.4): o que sai da recodificação não carrega metadados, conteúdo escondido nem
// fica maior que o limite; imagem que não decodifica é recusada. Não precisa de banco.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ASSINATURAS, recodificar } from '../src/servicos/imagem.ts';

const cor = { r: 200, g: 120, b: 90 };
async function jpegComExif(largura: number, altura: number, orientacao = 1) {
  return sharp({ create: { width: largura, height: altura, channels: 3, background: cor } })
    .jpeg()
    .withExif({ IFD0: { Make: 'CameraDoPaciente', Copyright: 'segredo' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } })
    .withMetadata({ orientation: orientacao })
    .toBuffer();
}

describe('recodificação de imagem', () => {
  it('remove EXIF (inclusive GPS) e qualquer texto do original', async () => {
    const original = await jpegComExif(800, 600);
    expect(original.includes(Buffer.from('CameraDoPaciente'))).toBe(true);
    const { imagem, miniatura } = await recodificar('image/jpeg', original);
    for (const b of [imagem, miniatura]) {
      expect(ASSINATURAS['image/jpeg'](b)).toBe(true);
      expect(b.includes(Buffer.from('CameraDoPaciente'))).toBe(false);
      expect((await sharp(b).metadata()).exif).toBeUndefined();
    }
  });

  it('descarta conteúdo anexado ao fim do arquivo (poliglota JPEG + HTML/ZIP)', async () => {
    const carga = Buffer.from('<script>alert(1)</script>PK\u0003\u0004conteudo-escondido');
    const poliglota = Buffer.concat([await jpegComExif(200, 200), carga]);
    const { imagem } = await recodificar('image/jpeg', poliglota);
    expect(imagem.includes(Buffer.from('conteudo-escondido'))).toBe(false);
    expect(imagem.includes(Buffer.from('<script>'))).toBe(false);
  });

  it('aplica a orientação antes de descartar o EXIF (foto não "deita") e limita o tamanho', async () => {
    const deitada = await jpegComExif(4000, 3000, 6); // 6 = girar 90°: a foto "de verdade" é 3000×4000
    const { imagem, miniatura, largura, altura } = await recodificar('image/jpeg', deitada);
    expect([largura, altura]).toEqual([1920, 2560]);
    const m = await sharp(miniatura).metadata();
    expect([m.width, m.height]).toEqual([240, 320]);
    expect((await sharp(imagem).metadata()).orientation).toBeUndefined();
  });

  it('mantém o formato declarado (PNG continua PNG, WebP continua WebP)', async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: { ...cor, alpha: 0.5 } } }).png().toBuffer();
    expect(ASSINATURAS['image/png']((await recodificar('image/png', png)).imagem)).toBe(true);
    const webp = await sharp({ create: { width: 50, height: 50, channels: 3, background: cor } }).webp().toBuffer();
    expect(ASSINATURAS['image/webp']((await recodificar('image/webp', webp)).imagem)).toBe(true);
  });

  it('recusa imagem corrompida (assinatura válida, conteúdo não)', async () => {
    const corrompida = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    expect(ASSINATURAS['image/jpeg'](corrompida)).toBe(true);
    await expect(recodificar('image/jpeg', corrompida)).rejects.toThrow();
  });
});
