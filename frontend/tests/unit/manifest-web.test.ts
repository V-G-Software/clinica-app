import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gerarManifestWeb } from '@/pwa/manifest-web';

describe('manifest web por organização', () => {
  it.each(['modelo-otorrino', 'fisio-movimento', 'vet-amigo'])('%s', (slug) => {
    const cfg = JSON.parse(readFileSync(path.resolve(process.cwd(), `../contrato/exemplos/respostas/publicoObterConfiguracao.${slug}.json`), 'utf8')).corpo;
    const m = gerarManifestWeb(cfg);
    expect(m.name).toBe(cfg.pwa.nome);
    expect(m.short_name).toBe(cfg.pwa.nomeCurto);
    expect(m.theme_color).toBe(cfg.pwa.corTema);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(m.display).toBe('standalone');
  });
});
