import { describe, expect, it } from 'vitest';
import { cabecalhosSeguranca, politicaCsp } from '../../borda/seguranca';

describe('CSP por organização', () => {
  const csp = politicaCsp({ urlApi: 'https://api.clinica.exemplo.com.br/o/x', diretorioUrl: 'https://diretorio.exemplo.com.br', origensEnvio: ['https://storage.exemplo.com.br/bucket'], producao: true });
  const d = Object.fromEntries(csp.split('; ').map((x) => [x.split(' ')[0], x.split(' ').slice(1)]));
  it('scripts e estilos só do próprio site, sem unsafe-inline/eval', () => {
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['style-src']).toEqual(["'self'"]);
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
  });
  it('connect-src com a API da organização, o diretório e o storage (só origens)', () => {
    expect(d['connect-src']).toEqual(["'self'", 'https://api.clinica.exemplo.com.br', 'https://diretorio.exemplo.com.br', 'https://storage.exemplo.com.br']);
  });
  it('não pode ser embutido em iframe e não tem plugins', () => { expect(d['frame-ancestors']).toEqual(["'none'"]); expect(d['object-src']).toEqual(["'none'"]); });
  it('HSTS só em produção; referrer nunca vaza', () => {
    expect(cabecalhosSeguranca({ urlApi: 'http://localhost:4010/o/x', diretorioUrl: 'http://localhost:4010/diretorio' })['Strict-Transport-Security']).toBeUndefined();
    expect(cabecalhosSeguranca({ urlApi: 'https://a.b', diretorioUrl: 'https://c.d', producao: true })['Referrer-Policy']).toBe('no-referrer');
  });
});
