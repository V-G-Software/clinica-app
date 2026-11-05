// Escala de cores da marca em OKLCH e ajuste de contraste WCAG.
// As cores semânticas (sucesso, atenção, erro) não passam por aqui: são fixas.

type RGB = [number, number, number];
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexParaRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}
export function rgbParaHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function rgbParaOklch([r, g, b]: RGB) {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}
function oklchParaRgbBruto(L: number, C: number, H: number): RGB {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const noGamut = (c: RGB) => c.every((x) => x >= -0.0005 && x <= 1.0005);
/** Converte para sRGB reduzindo o croma até caber no gamut (mantém luminosidade e matiz). */
export function oklchParaHex(L: number, C: number, H: number): string {
  let c = C;
  let rgb = oklchParaRgbBruto(L, c, H);
  while (!noGamut(rgb) && c > 0) { c = Math.max(0, c - 0.005); rgb = oklchParaRgbBruto(L, c, H); }
  return rgbParaHex(rgb);
}

export function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const PASSOS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const LUMINOSIDADE = [0.975, 0.94, 0.88, 0.8, 0.71, 0.62, 0.54, 0.46, 0.38, 0.3, 0.22];
const FATOR_CROMA = [0.12, 0.25, 0.5, 0.75, 0.92, 1, 1, 0.92, 0.8, 0.65, 0.5];

export type Escala = Record<(typeof PASSOS)[number], string>;
export function gerarEscala(hex: string): Escala {
  const { C, H } = rgbParaOklch(hexParaRgb(hex));
  return Object.fromEntries(PASSOS.map((p, i) => [p, oklchParaHex(LUMINOSIDADE[i], C * FATOR_CROMA[i], H)])) as Escala;
}

/**
 * Cor de ação (botões, links) com contraste mínimo contra o fundo.
 * Usa a cor da marca se ela já passa; senão, escurece (fundo claro) ou clareia (fundo escuro)
 * em passos de luminosidade até passar. Nunca devolve uma cor que reprove.
 */
export function corComContraste(hex: string, fundo: string, minimo = 4.5): { cor: string; ajustada: boolean } {
  if (contraste(hex, fundo) >= minimo) return { cor: hex.toUpperCase(), ajustada: false };
  const { L, C, H } = rgbParaOklch(hexParaRgb(hex));
  const escurecer = luminancia(fundo) > 0.18;
  for (let i = 1; i <= 100; i++) {
    const novoL = escurecer ? L - i * 0.01 : L + i * 0.01;
    if (novoL <= 0 || novoL >= 1) break;
    const cor = oklchParaHex(novoL, C, H);
    if (contraste(cor, fundo) >= minimo) return { cor, ajustada: true };
  }
  return { cor: escurecer ? '#000000' : '#FFFFFF', ajustada: true };
}
/** Texto legível (branco ou quase preto) sobre uma cor de fundo. */
export const textoSobre = (fundo: string) => (contraste('#FFFFFF', fundo) >= contraste('#18181B', fundo) ? '#FFFFFF' : '#18181B');
