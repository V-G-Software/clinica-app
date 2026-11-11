// Documentos (ADR-0018): o que a conformidade não alcança — criptografia do PAdES (verificação própria e,
// quando houver, do OpenSSL), PDF adulterado, CMS de outro documento recusado antes da entrega, PKCE e uso
// único do código no PSC de teste, falha fechada sem provedor, seed assinado e isolamento entre organizações.
// Pré-requisito: banco migrado e semeado com PSC_TESTE=1 (pnpm migrar && pnpm org:criar --todos).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../src/config.ts';
import { comOrg, pool } from '../src/db.ts';
import type { Log } from '../src/http.ts';
import { orgPorSlug, type Org } from '../src/nucleo.ts';
import { assinarDocumentos, criarDocumento, provedoresAnunciados } from '../src/servicos/documentos.ts';
import { cmsDeTeste, embutir, preparar, verificar } from '../src/servicos/pades.ts';
import { ErroPsc, autorizarNoPscTeste, pkce, provedor } from '../src/servicos/psc.ts';
import { storage } from '../src/servicos/storage.ts';

const log: Log = { info: () => undefined, warn: () => undefined, error: () => undefined };
async function pdfSimples(texto = 'Receita de teste') {
  const d = await PDFDocument.create();
  d.addPage().drawText(texto, { x: 50, y: 700, size: 14, font: await d.embedFont(StandardFonts.Helvetica) });
  return d.save();
}
const temOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();

describe('PAdES: preparar → hash → CMS → embutir → verificar', () => {
  it('assinatura cobre o arquivo inteiro e confere; o CMS tem os atributos do CAdES', async () => {
    const p = await preparar(await pdfSimples(), { nome: 'Dra. Teste', motivo: 'Receita', local: 'SP', em: new Date() });
    expect(p.byteRange[0]).toBe(0);
    expect(p.byteRange[2] + p.byteRange[3]).toBe(p.pdf.length);
    const pdf = embutir(p, cmsDeTeste(p.hash));
    expect(pdf.length).toBe(p.pdf.length); // o espaço reservado não muda o tamanho: o ByteRange continua valendo
    const v = verificar(pdf);
    expect(v).toMatchObject({ ok: true, titular: 'PSC DE TESTE - SEM VALIDADE JURIDICA', hash: p.hash.toString('hex') });
    expect(pdf.toString('latin1')).toMatch(/\/SubFilter\s*\/ETSI\.CAdES\.detached/);
  });

  it.runIf(temOpenssl)('o OpenSSL (implementação independente) valida o CMS sobre os bytes cobertos', async () => {
    const p = await preparar(await pdfSimples(), { nome: 'Dra. Teste', motivo: 'Receita', local: 'SP', em: new Date() });
    const cms = cmsDeTeste(p.hash);
    const dir = mkdtempSync(path.join(tmpdir(), 'pades-'));
    writeFileSync(path.join(dir, 'cms.der'), cms);
    writeFileSync(path.join(dir, 'conteudo.bin'), Buffer.concat([p.pdf.subarray(0, p.byteRange[1]), p.pdf.subarray(p.byteRange[2])]));
    const saida = execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', path.join(dir, 'cms.der'), '-content', path.join(dir, 'conteudo.bin'), '-noverify', '-out', path.join(dir, 'x')], { stdio: 'pipe' });
    expect(saida).toBeDefined(); // lança se a verificação falhar
    const atributos = execFileSync('openssl', ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', path.join(dir, 'cms.der')]).toString();
    expect(atributos).toMatch(/messageDigest/);
    expect(atributos).toMatch(/signingCertificateV2/);
  });

  it('PDF adulterado depois de assinado: a verificação falha', async () => {
    const p = await preparar(await pdfSimples(), { nome: 'X', motivo: 'Receita', local: 'SP', em: new Date() });
    const pdf = embutir(p, cmsDeTeste(p.hash));
    pdf[60] ^= 0x01; // um bit dentro do trecho coberto pela assinatura (o conteúdo da página fica comprimido)
    expect(verificar(pdf)).toMatchObject({ ok: false, motivo: 'o hash assinado não é o deste PDF' });
  });

  it('CMS de outro documento (hash trocado) não confere', async () => {
    const a = await preparar(await pdfSimples('A'), { nome: 'X', motivo: 'Receita', local: 'SP', em: new Date() });
    const b = await preparar(await pdfSimples('B'), { nome: 'X', motivo: 'Receita', local: 'SP', em: new Date() });
    expect(verificar(embutir(a, cmsDeTeste(b.hash))).ok).toBe(false);
  });
});

describe('PSC de teste: OAuth com PKCE', () => {
  const redirectUri = () => `${config.urlPublica}/o/modelo-otorrino/v1/documentos/assinaturas/retorno`;
  it('autoriza, exige o verificador PKCE certo e o código é de uso único', async () => {
    const p = provedor('teste')!;
    const { verificador, desafio } = pkce();
    const u = new URL(p.urlAutorizacao({ state: 's1', desafio, redirectUri: redirectUri(), quantidade: 1 }));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const volta = new URL(autorizarNoPscTeste(Object.fromEntries(u.searchParams))!);
    const code = volta.searchParams.get('code')!;
    expect(volta.searchParams.get('state')).toBe('s1');
    await expect(p.trocarCodigo({ code, verificador: pkce().verificador, redirectUri: redirectUri() })).rejects.toBeInstanceOf(ErroPsc);
    // O código já foi consumido pela tentativa errada: nem o verificador certo o reaproveita.
    await expect(p.trocarCodigo({ code, verificador, redirectUri: redirectUri() })).rejects.toBeInstanceOf(ErroPsc);
    const u2 = new URL(p.urlAutorizacao({ state: 's2', desafio, redirectUri: redirectUri(), quantidade: 1 }));
    const code2 = new URL(autorizarNoPscTeste(Object.fromEntries(u2.searchParams))!).searchParams.get('code')!;
    const token = await p.trocarCodigo({ code: code2, verificador, redirectUri: redirectUri() });
    const [cms] = await p.assinar(token, [createHash('sha256').update('x').digest()]);
    expect(cms.length).toBeGreaterThan(500);
    await expect(p.assinar(token, [createHash('sha256').update('x').digest()])).rejects.toBeInstanceOf(ErroPsc); // token de uso único
  });
  it('retorno só para este backend (o PSC de teste não vira redirecionador aberto)', () => {
    expect(autorizarNoPscTeste({ state: 's', code_challenge: 'c', redirect_uri: 'https://atacante.exemplo/x' })).toBeNull();
  });
  it('falha fechada: sem PSC configurado, nenhum provedor é anunciado', () => {
    const antes = config.psc.teste;
    try { config.psc.teste = false; expect(provedoresAnunciados()).toEqual(config.psc.provedores.map((p) => ({ id: p.id, nome: p.nome }))); }
    finally { config.psc.teste = antes; }
  });
});

describe('documentos no banco', () => {
  let org: Org;
  beforeAll(async () => { org = (await orgPorSlug('modelo-otorrino'))!; });
  afterAll(async () => { await pool.end().catch(() => undefined); });

  it('seed: atestado do Rafael assinado, com PDF guardado que confere e hash igual ao da validação', async () => {
    const d = await comOrg(org.id, async (tx) => (await tx.query(`SELECT * FROM documentos WHERE organizacao_id = $1 AND id = 'doc_rafael_atestado'`, [org.id])).rows[0]);
    expect(d).toMatchObject({ status: 'ASSINADO', codigo: 'RAFAEL7DIASSEPTO' });
    expect(d.mensagem_id).toBeTruthy();
    const pdf = (await storage.ler(`final/${org.id}/${d.arquivo_id}`))!;
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(d.sha256);
    expect(verificar(pdf).ok).toBe(true);
  });

  it('CMS que não confere com o PDF: nada é assinado nem entregue (a transação desfaz tudo)', async () => {
    let id = '';
    await expect(comOrg(org.id, async (tx) => {
      const d = await criarDocumento(tx, org, { pacienteId: 'pac_beatriz', emissorId: 'usr_ana', tipo: 'RECEITA', receita: { itens: [{ medicamento: 'Dipirona 500 mg', posologia: '1 comprimido se dor.' }] } });
      id = d.id;
      await assinarDocumentos(tx, org, [d.id], async (hashes) => hashes.map(() => cmsDeTeste(createHash('sha256').update('outro').digest())), log);
    })).rejects.toBeInstanceOf(ErroPsc);
    const depois = await comOrg(org.id, async (tx) => (await tx.query('SELECT 1 FROM documentos WHERE organizacao_id = $1 AND id = $2', [org.id, id])).rowCount);
    expect(depois).toBe(0);
  });

  it('isolamento (RLS): outra organização não enxerga os documentos nem as sessões', async () => {
    const vet = (await orgPorSlug('vet-amigo'))!;
    const n = await comOrg(vet.id, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM documentos WHERE organizacao_id = $1`, [org.id])).rows[0].n);
    expect(n).toBe(0);
    const s = await comOrg(vet.id, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM sessoes_assinatura`)).rows[0].n);
    const proprias = await comOrg(vet.id, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM sessoes_assinatura WHERE organizacao_id = $1`, [vet.id])).rows[0].n);
    expect(s).toBe(proprias);
  });
});
