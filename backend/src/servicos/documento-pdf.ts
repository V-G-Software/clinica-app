// PDF da receita/atestado (ADR-0018), gerado no servidor: o que se assina é exatamente o que se guarda
// e entrega. A4, Helvetica (WinAnsi cobre o português), QR com a validação pública.
import QRCode from 'qrcode';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

export interface DadosPdf {
  tipo: 'RECEITA' | 'ATESTADO';
  organizacao: { nome: string; endereco: string | null; telefone: string | null };
  emissor: { nome: string; conselho: string; numero: string; uf: string };
  paciente: { nome: string; animal: boolean; tutor: string | null };
  receita: { itens: Array<{ medicamento: string; posologia: string; quantidade: string | null }>; orientacoes: string | null } | null;
  atestado: { modalidade: 'AFASTAMENTO' | 'COMPARECIMENTO'; data: string; dias: number | null; horaInicio: string | null; horaFim: string | null; cid: string | null; observacoes: string | null } | null;
  emitidoEm: string; // data local AAAA-MM-DD
  codigo: string;
  urlValidacao: string;
  teste: boolean; // PSC de teste: rodapé "sem validade jurídica"
}

const br = (d: string) => d.split('-').reverse().join('/');
/** Remove o que a WinAnsi não representa (emoji etc.) para o PDF nunca falhar por um caractere. */
const limpo = (s: string) => s.normalize('NFC').replace(/[^\x20-\x7E\u00A0-\u00FF—–·•“”‘’…]/gu, '');

export async function gerarPdfDocumento(d: DadosPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(d.tipo === 'RECEITA' ? 'Receita' : 'Atestado'); doc.setProducer('clinica'); doc.setCreator('clinica');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  const M = 56; const LARGURA = 595.28 - 2 * M;
  let y = 841.89 - M;
  const novaPagina = () => { page = doc.addPage([595.28, 841.89]); y = 841.89 - M; };
  const escrever = (texto: string, o: { tam?: number; fonte?: PDFFont; cor?: [number, number, number]; antes?: number } = {}) => {
    const tam = o.tam ?? 11; const fonte = o.fonte ?? normal;
    y -= o.antes ?? 0;
    for (const linha of quebrar(limpo(texto), fonte, tam, LARGURA)) {
      if (y < M + 120) novaPagina();
      y -= tam * 1.4;
      page.drawText(linha, { x: M, y, size: tam, font: fonte, color: rgb(...(o.cor ?? [0.1, 0.1, 0.1])) });
    }
  };

  escrever(d.organizacao.nome, { tam: 15, fonte: negrito });
  const contato = [d.organizacao.endereco, d.organizacao.telefone].filter(Boolean).join(' · ');
  if (contato) escrever(contato, { tam: 9, cor: [0.35, 0.35, 0.35] });
  y -= 10; page.drawLine({ start: { x: M, y }, end: { x: M + LARGURA, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) });
  escrever(d.tipo === 'RECEITA' ? 'RECEITA' : 'ATESTADO', { tam: 16, fonte: negrito, antes: 18 });
  escrever(`${d.paciente.animal ? 'Animal' : 'Paciente'}: ${d.paciente.nome}${d.paciente.tutor ? ` (tutor/a: ${d.paciente.tutor})` : ''}`, { antes: 8 });

  if (d.receita) {
    d.receita.itens.forEach((i, n) => {
      escrever(`${n + 1}. ${i.medicamento}${i.quantidade ? ` — ${i.quantidade}` : ''}`, { fonte: negrito, antes: 12 });
      escrever(i.posologia, { tam: 11 });
    });
    if (d.receita.orientacoes) escrever(`Orientações: ${d.receita.orientacoes}`, { antes: 14 });
  } else if (d.atestado) {
    const a = d.atestado;
    const sujeito = d.paciente.animal ? 'o animal' : 'o(a) paciente';
    escrever(a.modalidade === 'AFASTAMENTO'
      ? `Atesto, para os devidos fins, que ${sujeito} acima necessita de ${a.dias} dia(s) de afastamento de suas atividades a partir de ${br(a.data)}.`
      : `Atesto, para os devidos fins, que ${sujeito} acima esteve em atendimento em ${br(a.data)}, das ${a.horaInicio} às ${a.horaFim}.`, { antes: 14 });
    if (a.cid) escrever(`CID: ${a.cid} (informado com autorização expressa do paciente).`, { antes: 8 });
    if (a.observacoes) escrever(a.observacoes, { antes: 8 });
  }

  escrever(`${d.emissor.nome}`, { fonte: negrito, antes: 36 });
  escrever(`${d.emissor.conselho} ${d.emissor.numero}/${d.emissor.uf}`);
  escrever(`Emitido em ${br(d.emitidoEm)}. Assinado digitalmente.`, { tam: 9, cor: [0.35, 0.35, 0.35] });

  // Rodapé com QR e validação, sempre na última página.
  const qr = await doc.embedPng(await QRCode.toBuffer(d.urlValidacao, { margin: 1, width: 240, errorCorrectionLevel: 'M' }));
  rodape(page, normal, negrito, qr, d, M, LARGURA);
  return doc.save({ useObjectStreams: false });
}

function rodape(page: PDFPage, normal: PDFFont, negrito: PDFFont, qr: any, d: DadosPdf, M: number, L: number) {
  const lado = 84;
  page.drawImage(qr, { x: M, y: M, width: lado, height: lado });
  const x = M + lado + 12; let y = M + lado - 10;
  const linha = (t: string, f: PDFFont, tam: number) => { for (const l of quebrar(limpo(t), f, tam, L - lado - 12)) { page.drawText(l, { x, y, size: tam, font: f, color: rgb(0.2, 0.2, 0.2) }); y -= tam * 1.35; } };
  linha(`Código de validação: ${d.codigo}`, negrito, 10);
  linha(d.urlValidacao, normal, 8);
  linha('Documento assinado com certificado digital. Confira a assinatura em validar.iti.gov.br e a situação (válido ou anulado) pelo código acima.', normal, 8);
  if (d.teste) linha('AMBIENTE DE TESTE: assinatura com certificado simulado, SEM VALIDADE JURÍDICA.', negrito, 9);
}

function quebrar(texto: string, fonte: PDFFont, tam: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split('\n')) {
    let atual = '';
    for (const palavra of paragrafo.split(/\s+/)) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tam) <= largura) atual = tentativa;
      else { if (atual) linhas.push(atual); atual = palavra; }
    }
    linhas.push(atual);
  }
  return linhas;
}
