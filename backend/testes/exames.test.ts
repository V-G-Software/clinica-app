// Exames (ADR-0017): o que a conformidade não alcança — protocolo do clamd (servidor falso), saneamento
// de PDF com conteúdo ativo, PDF criptografado, unicidade do arquivo em resultados sob concorrência,
// capacidade de PDF só com antivírus e o seed.
// Pré-requisito: banco migrado e semeado (pnpm migrar && pnpm org:criar --todos).
import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { config } from '../src/config.ts';
import { novoId } from '../src/cripto.ts';
import { comOrg, pool } from '../src/db.ts';
import type { Log } from '../src/http.ts';
import { orgPorSlug, type Org } from '../src/nucleo.ts';
import { AntivirusIndisponivel, verificarClamd } from '../src/servicos/antivirus.ts';
import { capacidadeUpload, criarResultado } from '../src/servicos/exames.ts';
import { PdfInvalido, sanear } from '../src/servicos/pdf.ts';

const log: Log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** PDF montado à mão (objetos numerados a partir de 1, xref correta); `trailerExtra` entra no trailer. */
function montarPdf(objs: string[], trailerExtra = '') {
  let corpo = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(corpo, 'latin1')); corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(corpo, 'latin1');
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  corpo += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}
const conteudo = 'BT /F1 18 Tf 72 720 Td (Hemograma) Tj ET';
/** PDF com tudo o que o saneamento precisa remover. */
const PDF_ATIVO = montarPdf([
  "<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R /AA << /WC 6 0 R >> /Names << /JavaScript << /Names [(x) 6 0 R] >> /EmbeddedFiles << /Names [(a.exe) 7 0 R] >> >> /AcroForm << /Fields [] >> >>",
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [8 0 R] /AA << /O 6 0 R >> >>',
  `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  "<< /S /JavaScript /JS (app.alert('x')) >>",
  '<< /Type /Filespec /F (a.exe) >>',
  '<< /Type /Annot /Subtype /Link /Rect [0 0 100 100] /A << /S /URI /URI (http://exemplo.invalid) >> >>',
]);

describe('antivírus: protocolo clamd INSTREAM (servidor falso)', () => {
  let srv: Server;
  let porta = 0;
  beforeAll(async () => {
    // Lê "zINSTREAM\0", junta os blocos [uint32 BE][dados] até o bloco vazio e responde como o clamd.
    srv = createServer((s) => {
      let buf = Buffer.alloc(0);
      s.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (!buf.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return;
        let i = 10; const dados: Buffer[] = [];
        while (i + 4 <= buf.length) {
          const n = buf.readUInt32BE(i);
          if (n === 0) { const tudo = Buffer.concat(dados); s.end(tudo.includes(Buffer.from(EICAR, 'latin1')) ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0'); return; }
          if (i + 4 + n > buf.length) return;
          dados.push(buf.subarray(i + 4, i + 4 + n)); i += 4 + n;
        }
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    porta = (srv.address() as any).port;
  });
  afterAll(() => srv.close());

  it('arquivo limpo (em vários blocos) → OK; com EICAR → recusado com a assinatura', async () => {
    const grande = Buffer.concat([Buffer.alloc(200_000, 0x41), Buffer.from('fim')]);
    expect(await verificarClamd(`tcp://127.0.0.1:${porta}`, grande)).toEqual({ limpo: true });
    expect(await verificarClamd(`tcp://127.0.0.1:${porta}`, Buffer.concat([grande, Buffer.from(EICAR, 'latin1')]))).toEqual({ limpo: false, assinatura: 'Eicar-Signature' });
  });
  it('clamd fora do ar → AntivirusIndisponivel (o arquivo fica PROCESSANDO e um job tenta de novo)', async () => {
    await expect(verificarClamd('tcp://127.0.0.1:1', Buffer.from('x'), 2000)).rejects.toBeInstanceOf(AntivirusIndisponivel);
  });
});

describe('saneamento de PDF', () => {
  it('remove JavaScript, ações, anexos, formulários e anotações; mantém as páginas', async () => {
    expect(PDF_ATIVO.toString('latin1')).toMatch(/\/JavaScript/);
    const { pdf, paginas } = await sanear(PDF_ATIVO);
    expect(paginas).toBe(1);
    const texto = pdf.toString('latin1');
    for (const proibido of ['/JavaScript', '/JS', '/OpenAction', '/EmbeddedFiles', '/AcroForm', '/Annots', '/URI', '/AA', 'a.exe'])
      expect(texto, proibido).not.toContain(proibido);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
  it('PDF criptografado ou ilegível é recusado (PdfInvalido)', async () => {
    const cripto = montarPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>', '<< /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4 >>'], '/Encrypt 3 0 R ');
    await expect(sanear(cripto)).rejects.toBeInstanceOf(PdfInvalido);
    await expect(sanear(Buffer.from('%PDF-1.4\nlixo'))).rejects.toBeInstanceOf(PdfInvalido);
  });
});

describe('exames no banco', () => {
  let org: Org;
  beforeAll(async () => { org = (await orgPorSlug('modelo-otorrino'))!; });
  afterAll(async () => { await pool.end(); });

  it('PDF só é anunciado com antivírus configurado (falha fechada)', () => {
    const antes = config.antivirus;
    try {
      (config as any).antivirus = 'teste';
      expect(capacidadeUpload(org).tiposPermitidosExame).toContain('application/pdf');
      (config as any).antivirus = null;
      expect(capacidadeUpload(org).tiposPermitidosExame).not.toContain('application/pdf');
      expect(capacidadeUpload(org).tiposPermitidos).not.toContain('application/pdf');
    } finally { (config as any).antivirus = antes; }
  });

  it('o mesmo arquivo em dois resultados simultâneos: só um entra (PK de resultado_arquivos)', async () => {
    const arq = novoId('arq');
    await comOrg(org.id, (tx) => tx.query(`INSERT INTO arquivos (organizacao_id, id, dono_id, nome, tipo, tamanho_bytes, finalidade, status, chave_storage)
      VALUES ($1,$2,'usr_ana','x.png','image/png',10,'EXAME','DISPONIVEL',$3)`, [org.id, arq, `final/${org.id}/${arq}`]));
    const tentar = () => comOrg(org.id, (tx) => criarResultado(tx, org, { pacienteId: 'pac_beatriz', titulo: 'Concorrência', arquivosIds: [arq], enviadoPor: 'usr_ana', origem: 'EQUIPE' }, log));
    const r = await Promise.allSettled([tentar(), tentar(), tentar()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const n = await comOrg(org.id, async (tx) => (await tx.query('SELECT count(*)::int AS n FROM resultado_arquivos WHERE organizacao_id = $1 AND arquivo_id = $2', [org.id, arq])).rows[0].n);
    expect(n).toBe(1);
  });

  it('seed: pedido da Beatriz aberto com o hemograma aguardando; tomografia do Marcos revisada e pedido concluído', async () => {
    const ler = (sql: string, p: unknown[]) => comOrg(org.id, async (tx) => (await tx.query(sql, p)).rows);
    const ped = Object.fromEntries((await ler('SELECT id, status FROM pedidos_exame WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, ['ped_beatriz_preop', 'ped_marcos_tc']])).map((x) => [x.id, x.status]));
    expect(ped).toEqual({ ped_beatriz_preop: 'ABERTO', ped_marcos_tc: 'CONCLUIDO' });
    const res = await ler('SELECT id, status, origem, revisado_por, nota_revisao FROM resultados_exame WHERE organizacao_id = $1 AND id = ANY($2) ORDER BY id', [org.id, ['res_beatriz_hemograma', 'res_marcos_tc']]);
    expect(res).toEqual([
      { id: 'res_beatriz_hemograma', status: 'AGUARDANDO_REVISAO', origem: 'PACIENTE', revisado_por: null, nota_revisao: null },
      { id: 'res_marcos_tc', status: 'REVISADO', origem: 'EQUIPE', revisado_por: 'usr_carlos', nota_revisao: 'Sem alterações que impeçam a cirurgia.' },
    ]);
  });
});
