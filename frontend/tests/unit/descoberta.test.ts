import { describe, expect, it } from 'vitest';
import { descobrirOrganizacao } from '@/app/descoberta';

const op = (dev = false) => ({ dev, dominioPrincipal: 'exemplo.com.br' });
describe('descoberta da organização', () => {
  it('subdomínio do domínio principal', () => expect(descobrirOrganizacao(new URL('https://modelo-otorrino.exemplo.com.br/'), op())).toEqual({ tipo: 'slug', slug: 'modelo-otorrino', origem: 'subdominio' }));
  it('domínio próprio vai para o diretório por domínio', () => expect(descobrirOrganizacao(new URL('https://app.clinicax.com.br/'), op())).toEqual({ tipo: 'dominio', dominio: 'app.clinicax.com.br' }));
  it('?org= só vale em desenvolvimento', () => {
    expect(descobrirOrganizacao(new URL('https://app.clinicax.com.br/?org=vet-amigo'), op(false))).toEqual({ tipo: 'dominio', dominio: 'app.clinicax.com.br' });
    expect(descobrirOrganizacao(new URL('http://localhost:5173/?org=vet-amigo'), op(true))).toMatchObject({ slug: 'vet-amigo', origem: 'parametro' });
  });
  it('link de convite traz a organização mesmo em produção', () => expect(descobrirOrganizacao(new URL('https://exemplo.com.br/convite/abc?org=fisio-movimento'), op())).toMatchObject({ slug: 'fisio-movimento', origem: 'convite' }));
  it('slug inválido é ignorado', () => expect(descobrirOrganizacao(new URL('http://localhost/?org=../x'), op(true))).toBeNull());
});
