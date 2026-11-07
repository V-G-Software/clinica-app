// PDF mínimo e válido (1 página, texto), com tabela xref correta: abre em qualquer leitor e em pdf-lib.
// `extra` entra como conteúdo de um objeto à parte (por exemplo, a assinatura de teste EICAR).
export function gerarPdf(texto = 'Resultado de exame', extra?: string): Buffer {
  const conteudo = `BT /F1 18 Tf 72 720 Td (${texto.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...(extra ? [`<< /Length ${extra.length} >>\nstream\n${extra}\nendstream`] : []),
  ];
  let corpo = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(corpo, 'latin1')); corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(corpo, 'latin1');
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  corpo += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}
/** Assinatura de teste padrão de antivírus (inofensiva; todo antivírus a reconhece). */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
