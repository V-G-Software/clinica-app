// Comparação semver simplificada (MAJOR.MINOR.PATCH[-pre]); pré-release é menor que a final.
export function compararVersoes(a: string, b: string): number {
  const p = (v: string) => {
    const [num, pre] = v.split('-', 2);
    return { n: num.split('.').map((x) => Number(x) || 0), pre: pre ?? null };
  };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) < (y.n[i] ?? 0) ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}
export const versaoMaior = (v: string) => Number(v.split('.')[0]);
/** Versões maiores do contrato que este build entende. */
export const CONTRATO_MAIOR_SUPORTADO = 1;
