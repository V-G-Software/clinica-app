// Parser incremental de text/event-stream (comentários, id, event, data multilinha).
export interface MensagemSse { id?: string; event?: string; data: string }

export function criarParserSse(aoMensagem: (m: MensagemSse) => void) {
  let buffer = '';
  return (pedaco: string) => {
    buffer += pedaco.replace(/\r\n?/g, '\n');
    let fim: number;
    while ((fim = buffer.indexOf('\n\n')) >= 0) {
      const bloco = buffer.slice(0, fim);
      buffer = buffer.slice(fim + 2);
      const m: MensagemSse = { data: '' };
      const dados: string[] = [];
      for (const linha of bloco.split('\n')) {
        if (!linha || linha.startsWith(':')) continue; // comentário (": ping")
        const i = linha.indexOf(':');
        const campo = i < 0 ? linha : linha.slice(0, i);
        const valor = i < 0 ? '' : linha.slice(i + 1).replace(/^ /, '');
        if (campo === 'data') dados.push(valor);
        else if (campo === 'id') m.id = valor;
        else if (campo === 'event') m.event = valor;
      }
      if (dados.length) { m.data = dados.join('\n'); aoMensagem(m); }
    }
  };
}
