// Assinatura PAdES em duas fases (ADR-0018). O PDF nunca sai do servidor: o PSC recebe só o hash.
//   1. `preparar`: reserva o espaço da assinatura (/ByteRange e /Contents) e calcula o SHA-256 dos bytes
//      cobertos — é esse hash que vai ao PSC (vários documentos numa só autorização).
//   2. `embutir`: grava o CMS (PKCS#7 destacado, ETSI.CAdES.detached) devolvido pelo PSC no espaço reservado.
// `verificar` refaz a conta (ByteRange → hash → messageDigest → assinatura dos atributos) para os testes e
// para recusar um CMS que não corresponda ao documento antes de entregá-lo.
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign as assinarRsa, verify as verificarRsa } from 'node:crypto';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { findByteRange, removeTrailingNewLine, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';

const TAMANHO_ASSINATURA = 16_384; // bytes reservados para o CMS (cadeia ICP-Brasil completa cabe com folga)
const OID = {
  sha256: '2.16.840.1.101.3.4.2.1', rsa: '1.2.840.113549.1.1.1', sha256Rsa: '1.2.840.113549.1.1.11',
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4', signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
};

export interface Preparado { pdf: Buffer; byteRange: [number, number, number, number]; hash: Buffer }

/** Reserva o espaço da assinatura e devolve o hash (SHA-256) do que ela vai cobrir. */
export async function preparar(pdfBytes: Uint8Array, info: { nome: string; motivo: string; local: string; contato?: string; em: Date }): Promise<Preparado> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  pdflibAddPlaceholder({
    pdfDoc: doc, reason: info.motivo, contactInfo: info.contato ?? '', name: info.nome, location: info.local,
    signingTime: info.em, signatureLength: TAMANHO_ASSINATURA, subFilter: SUBFILTER_ETSI_CADES_DETACHED, appName: 'clinica',
  });
  let pdf = removeTrailingNewLine(Buffer.from(await doc.save({ useObjectStreams: false })));
  const { byteRangePlaceholder, byteRangePlaceholderPosition } = findByteRange(pdf);
  if (!byteRangePlaceholder) throw new Error('PDF sem espaço de assinatura');
  const pos = byteRangePlaceholderPosition!;
  const fimByteRange = pos + byteRangePlaceholder.length;
  const inicioContents = pdf.indexOf('<', pdf.indexOf('/Contents ', fimByteRange));
  const fimContents = pdf.indexOf('>', inicioContents) + 1;
  const byteRange: Preparado['byteRange'] = [0, inicioContents, fimContents, pdf.length - fimContents];
  let texto = `/ByteRange [${byteRange.join(' ')}]`;
  texto += ' '.repeat(byteRangePlaceholder.length - texto.length);
  pdf = Buffer.concat([pdf.subarray(0, pos), Buffer.from(texto), pdf.subarray(fimByteRange)]);
  return { pdf, byteRange, hash: hashCoberto(pdf, byteRange) };
}
const hashCoberto = (pdf: Buffer, br: number[]) =>
  createHash('sha256').update(pdf.subarray(br[0], br[0] + br[1])).update(pdf.subarray(br[2], br[2] + br[3])).digest();

/** Grava o CMS no espaço reservado (hex, completado com zeros). */
export function embutir(p: Preparado, cms: Buffer): Buffer {
  const espaco = p.byteRange[2] - p.byteRange[1] - 2;
  const hex = cms.toString('hex');
  if (hex.length > espaco) throw new Error(`assinatura maior que o espaço reservado (${hex.length} > ${espaco})`);
  const pdf = Buffer.from(p.pdf);
  pdf.write(`<${hex.padEnd(espaco, '0')}>`, p.byteRange[1], 'latin1');
  return pdf;
}

// ─────────── Verificação ───────────
export interface Verificacao { ok: boolean; motivo?: string; titular?: string; hash?: string }
/** Confere a única assinatura do PDF: ByteRange cobre o arquivo todo, messageDigest = hash e a assinatura dos atributos. */
export function verificar(pdf: Buffer): Verificacao {
  try {
    const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(pdf.toString('latin1'));
    if (!m) return { ok: false, motivo: 'sem assinatura' };
    const br = m.slice(1).map(Number);
    if (br[0] !== 0 || br[2] + br[3] !== pdf.length) return { ok: false, motivo: 'a assinatura não cobre o arquivo inteiro' };
    const hex = pdf.subarray(br[1] + 1, br[2] - 1).toString('latin1').replace(/(00)+$/, '');
    const cms = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex').toString('binary')), false);
    const p7 = forge.pkcs7.messageFromAsn1(cms) as any;
    const signerInfo = p7.rawCapture.signerInfos?.[0] ?? (cms.value[1] as any).value[0].value[0].value[4].value[0];
    const attrsAsn1 = (signerInfo.value as any[]).find((v) => v.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && v.type === 0);
    if (!attrsAsn1) return { ok: false, motivo: 'CMS sem atributos assinados' };
    let digest: string | null = null;
    for (const a of attrsAsn1.value as any[]) if (forge.asn1.derToOid(a.value[0].value) === OID.messageDigest) digest = Buffer.from(a.value[1].value[0].value, 'binary').toString('hex');
    const hash = hashCoberto(pdf, br).toString('hex');
    if (digest !== hash) return { ok: false, motivo: 'o hash assinado não é o deste PDF', hash };
    // Os atributos são assinados como SET (tag 0x31), não com a tag implícita [0].
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrsAsn1.value);
    const der = Buffer.from(forge.asn1.toDer(set).getBytes(), 'binary');
    const assinatura = Buffer.from((signerInfo.value as any[]).find((v) => v.type === forge.asn1.Type.OCTETSTRING && v.tagClass === forge.asn1.Class.UNIVERSAL).value, 'binary');
    const cert = p7.certificates[0];
    const chave = createPublicKey(forge.pki.publicKeyToPem(cert.publicKey));
    if (!verificarRsa('sha256', der, chave, assinatura)) return { ok: false, motivo: 'assinatura criptográfica inválida', hash };
    return { ok: true, titular: cert.subject.getField('CN')?.value, hash };
  } catch (e: any) {
    return { ok: false, motivo: `CMS ilegível: ${e?.message ?? e}` };
  }
}

// ─────────── PSC de teste: CMS com certificado autoassinado (NÃO é ICP-Brasil) ───────────
export interface CertTeste { chavePem: string; certDer: Buffer; cert: forge.pki.Certificate }
let certTeste: CertTeste | null = null;
/** Certificado autoassinado "PSC DE TESTE — SEM VALIDADE JURÍDICA", gerado uma vez por processo. */
export function certificadoDeTeste(): CertTeste {
  if (certTeste) return certTeste;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = `01${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nome = [{ name: 'commonName', value: 'PSC DE TESTE - SEM VALIDADE JURIDICA' }, { name: 'organizationName', value: 'clinica (ambiente de teste)' }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(nome); cert.setIssuer(nome);
  const chavePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  cert.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()), forge.md.sha256.create());
  certTeste = { chavePem, certDer: Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary'), cert };
  return certTeste;
}

/** CMS SignedData destacado (CAdES-BES: contentType, messageDigest, signingCertificateV2) sobre um hash SHA-256. */
export function cmsDeTeste(hash: Buffer, c: CertTeste = certificadoDeTeste()): Buffer {
  const { asn1 } = forge;
  const U = asn1.Class.UNIVERSAL; const T = asn1.Type;
  const oid = (o: string) => asn1.create(U, T.OID, false, asn1.oidToDer(o).getBytes());
  const algSha256 = () => asn1.create(U, T.SEQUENCE, true, [oid(OID.sha256), asn1.create(U, T.NULL, false, '')]);
  const certAsn1 = forge.pki.certificateToAsn1(c.cert);
  const certHash = createHash('sha256').update(c.certDer).digest().toString('binary');
  const atributos = [
    asn1.create(U, T.SEQUENCE, true, [oid(OID.contentType), asn1.create(U, T.SET, true, [oid(OID.data)])]),
    asn1.create(U, T.SEQUENCE, true, [oid(OID.messageDigest), asn1.create(U, T.SET, true, [asn1.create(U, T.OCTETSTRING, false, hash.toString('binary'))])]),
    // signingCertificateV2 (RFC 5035): exigido pelo PAdES; liga a assinatura a este certificado.
    asn1.create(U, T.SEQUENCE, true, [oid(OID.signingCertificateV2), asn1.create(U, T.SET, true, [
      asn1.create(U, T.SEQUENCE, true, [asn1.create(U, T.SEQUENCE, true, [asn1.create(U, T.SEQUENCE, true, [asn1.create(U, T.OCTETSTRING, false, certHash)])])]),
    ])]),
  ];
  const der = Buffer.from(asn1.toDer(asn1.create(U, T.SET, true, atributos)).getBytes(), 'binary');
  const assinatura = assinarRsa('sha256', der, c.chavePem);
  const issuerAndSerial = asn1.create(U, T.SEQUENCE, true, [(forge.pki as any).distinguishedNameToAsn1(c.cert.issuer), asn1.create(U, T.INTEGER, false, forge.util.hexToBytes(c.cert.serialNumber))]);
  const signerInfo = asn1.create(U, T.SEQUENCE, true, [
    asn1.create(U, T.INTEGER, false, asn1.integerToDer(1).getBytes()), issuerAndSerial, algSha256(),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, atributos),
    asn1.create(U, T.SEQUENCE, true, [oid(OID.sha256Rsa), asn1.create(U, T.NULL, false, '')]),
    asn1.create(U, T.OCTETSTRING, false, assinatura.toString('binary')),
  ]);
  const signedData = asn1.create(U, T.SEQUENCE, true, [
    asn1.create(U, T.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(U, T.SET, true, [algSha256()]),
    asn1.create(U, T.SEQUENCE, true, [oid(OID.data)]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [certAsn1]),
    asn1.create(U, T.SET, true, [signerInfo]),
  ]);
  const contentInfo = asn1.create(U, T.SEQUENCE, true, [oid(OID.signedData), asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])]);
  return Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');
}
