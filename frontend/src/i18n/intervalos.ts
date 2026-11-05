// "1-7" → [1..7]; "1,3,5-7" → [1,3,5,6,7]. Ordenado e sem repetição; null se inválido.
export function lerDias(texto: string, maximo = 365): number[] | null {
  const dias = new Set<number>();
  for (const parte of texto.split(/[,;\s]+/).filter(Boolean)) {
    const m = parte.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const a = Number(m[1]); const b = m[2] !== undefined ? Number(m[2]) : a;
    if (a > b || b > maximo) return null;
    for (let d = a; d <= b; d++) dias.add(d);
  }
  return dias.size ? [...dias].sort((x, y) => x - y) : null;
}
/** [1,2,3,5,7,8] → "1-3, 5, 7-8" */
export function escreverDias(dias: number[]): string {
  const ord = [...new Set(dias)].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < ord.length; i++) {
    let j = i;
    while (j + 1 < ord.length && ord[j + 1] === ord[j] + 1) j++;
    partes.push(j > i ? `${ord[i]}-${ord[j]}` : `${ord[i]}`);
    i = j;
  }
  return partes.join(', ');
}
