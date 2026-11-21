// PDF da cópia do prontuário (ADR-0019, RN-PRO-005), gerado no servidor: ficha atual e todos os registros
// finalizados, em ordem cronológica, com autor, data e hora. A4, Helvetica (WinAnsi cobre o português).
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { limpo, quebrar } from './documento-pdf.ts';

export interface DadosCopia {
  organizacao: string;
  paciente: { nome: string; animal: boolean; tutor: string | null; dataNascimento: string | null };
  geradaEm: string; // "dd/mm/aaaa hh:mm" no fuso da organização
  geradaPor: string;
  ficha: {
    versao: number; atualizadaEm: string | null; atualizadaPor: string | null;
    alergias: string[]; medicamentos: string[]; problemas: string[];
    antecedentes: { pessoais: string | null; familiares: string | null; habitos: string | null };
  };
  registros: Array<{ titulo: string; quando: string; autor: string; texto: string | null; respostas: Array<{ rotulo: string; valor: string }>; origem: string | null }>;
}

export async function gerarPdfCopia(d: DadosCopia): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle('Cópia do prontuário'); doc.setProducer('clinica'); doc.setCreator('clinica');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const M = 56; const LARGURA = A4[0] - 2 * M;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const escrever = (texto: string, o: { tam?: number; fonte?: PDFFont; antes?: number; cor?: [number, number, number] } = {}) => {
    const tam = o.tam ?? 10; const fonte = o.fonte ?? normal;
    y -= o.antes ?? 0;
    for (const linha of quebrar(limpo(texto), fonte, tam, LARGURA)) {
      if (y < M + 30) { page = doc.addPage(A4); y = A4[1] - M; }
      y -= tam * 1.4;
      page.drawText(linha, { x: M, y, size: tam, font: fonte, color: rgb(...(o.cor ?? [0.1, 0.1, 0.1])) });
    }
  };
  const lista = (rotulo: string, itens: string[], vazio: string) => escrever(`${rotulo}: ${itens.length ? itens.join('; ') : vazio}`);

  escrever(d.organizacao, { tam: 13, fonte: negrito });
  escrever('CÓPIA DO PRONTUÁRIO', { tam: 16, fonte: negrito, antes: 6 });
  escrever(`${d.paciente.animal ? 'Animal' : 'Paciente'}: ${d.paciente.nome}`, { antes: 8 });
  if (d.paciente.tutor) escrever(`Tutor(a): ${d.paciente.tutor}`);
  if (d.paciente.dataNascimento) escrever(`Nascimento: ${d.paciente.dataNascimento.split('-').reverse().join('/')}`);
  escrever(`Gerada em ${d.geradaEm} por ${d.geradaPor}`);

  escrever('Ficha clínica', { tam: 12, fonte: negrito, antes: 12 });
  if (d.ficha.versao === 0) escrever('Nenhuma informação registrada na ficha.');
  else {
    escrever(`Versão ${d.ficha.versao}${d.ficha.atualizadaEm ? `, atualizada em ${d.ficha.atualizadaEm}` : ''}${d.ficha.atualizadaPor ? ` por ${d.ficha.atualizadaPor}` : ''}`, { tam: 9, cor: [0.35, 0.35, 0.35] });
    lista('Alergias', d.ficha.alergias, 'nenhuma registrada');
    lista('Medicações em uso', d.ficha.medicamentos, 'nenhuma registrada');
    lista('Problemas e diagnósticos', d.ficha.problemas, 'nenhum registrado');
    const a = d.ficha.antecedentes;
    if (a.pessoais) escrever(`Antecedentes pessoais: ${a.pessoais}`);
    if (a.familiares) escrever(`Antecedentes familiares: ${a.familiares}`);
    if (a.habitos) escrever(`Hábitos: ${a.habitos}`);
  }

  escrever('Registros', { tam: 12, fonte: negrito, antes: 12 });
  if (!d.registros.length) escrever('Nenhum registro finalizado.');
  for (const r of d.registros) {
    escrever(`${r.quando} · ${r.titulo} · ${r.autor}`, { fonte: negrito, antes: 8 });
    if (r.origem) escrever(r.origem, { tam: 9, cor: [0.35, 0.35, 0.35] });
    for (const x of r.respostas) escrever(`${x.rotulo}: ${x.valor}`);
    if (r.texto) escrever(r.texto);
  }

  escrever('Cópia gerada a pedido do titular (LGPD, art. 19). Registros finalizados não são alterados; correções aparecem como adendo.', { tam: 8, antes: 16, cor: [0.35, 0.35, 0.35] });
  const paginas = doc.getPages();
  paginas.forEach((p, i) => p.drawText(`${i + 1}/${paginas.length}`, { x: A4[0] - M - 20, y: M / 2, size: 8, font: normal, color: rgb(0.4, 0.4, 0.4) }));
  return doc.save();
}
