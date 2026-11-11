// PDF mínimo e VÁLIDO (com tabela xref), para o saneamento do backend (pdf-lib) aceitar. `extra` entra
// como comentário — serve para embutir a assinatura de teste EICAR (o antivírus deve recusar).
export function gerarPdf(extra = '') {
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>'];
  let s = `%PDF-1.4\n${extra ? `% ${extra}\n` : ''}`;
  const pos = objs.map((o, i) => { const p = Buffer.byteLength(s, 'latin1'); s += `${i + 1} 0 obj\n${o}\nendobj\n`; return p; });
  const xref = Buffer.byteLength(s, 'latin1');
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
