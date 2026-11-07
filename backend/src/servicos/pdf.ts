// Saneamento de PDF (ADR-0017). O PDF NÃO é corrigido no lugar: as páginas são copiadas para um
// documento novo, que nasce sem o que fica no catálogo do original — JavaScript de abertura
// (/OpenAction, /AA, /Names/JavaScript), anexos (/EmbeddedFiles), formulários (/AcroForm), XMP e
// metadados. Antes da cópia, as páginas de origem perdem anotações (/Annots: links /URI, /Launch,
// /JavaScript, campos) e ações (/AA) — senão os objetos referenciados viriam junto, mesmo órfãos.
// Defesa em profundidade: a saída é gravada sem object streams (nomes em texto) e varrida; se ainda
// houver nome de conteúdo ativo, o PDF é recusado. Criptografado ou ilegível também é recusado.
import { PDFDocument, PDFName } from 'pdf-lib';

export const ehPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
const PAGINAS_MAXIMAS = 200;
const ATIVO = /\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFiles?|AcroForm|RichMedia|SubmitForm|ImportData|GoToR|URI)\b/;

export class PdfInvalido extends Error {}

export async function sanear(bytes: Buffer): Promise<{ pdf: Buffer; paginas: number }> {
  try {
    let origem: PDFDocument;
    try {
      origem = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false });
    } catch (e: any) {
      throw new PdfInvalido(/encrypt/i.test(String(e?.message)) ? 'PDF protegido por senha.' : 'PDF ilegível.');
    }
    if (origem.isEncrypted) throw new PdfInvalido('PDF protegido por senha.');
    const n = origem.getPageCount();
    if (n === 0) throw new PdfInvalido('PDF sem páginas.');
    if (n > PAGINAS_MAXIMAS) throw new PdfInvalido(`PDF com mais de ${PAGINAS_MAXIMAS} páginas.`);
    for (const p of origem.getPages()) { p.node.delete(PDFName.of('Annots')); p.node.delete(PDFName.of('AA')); }
    const novo = await PDFDocument.create({ updateMetadata: false });
    for (const p of await novo.copyPages(origem, origem.getPageIndices())) novo.addPage(p);
    novo.setProducer('clinica'); novo.setCreator('clinica');
    const pdf = Buffer.from(await novo.save({ useObjectStreams: false }));
    if (ATIVO.test(pdf.toString('latin1'))) throw new PdfInvalido('PDF com conteúdo ativo que não pôde ser removido.');
    return { pdf, paginas: n };
  } catch (e) {
    if (e instanceof PdfInvalido) throw e;
    throw new PdfInvalido('PDF ilegível.');
  }
}
