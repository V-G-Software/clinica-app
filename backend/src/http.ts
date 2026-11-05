import type { Tx } from './db.ts';
import type { Ctx, Org } from './nucleo.ts';
export interface Log { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void; error: (o: unknown, m: string) => void }
export interface Req {
  org: Org; ctx: Ctx | null; tx: Tx; params: Record<string, string>; query: Record<string, any>; body: any;
  headers: Record<string, any>; ip: string; nativo: boolean; cookieRenovacao?: string; requestId: string; log: Log;
}
export interface Res { status: number; body?: unknown; headers?: Record<string, string>; cookie?: string; depoisDoCommit?: () => void }
export type Handler = (q: Req) => Promise<Res>;
export const ok = (body: unknown, headers?: Record<string, string>): Res => ({ status: 200, body, headers });
export const criado = (body: unknown, headers?: Record<string, string>): Res => ({ status: 201, body, headers });
export const vazio = (status = 204): Res => ({ status });
export const C = (q: Req) => q.ctx!;
