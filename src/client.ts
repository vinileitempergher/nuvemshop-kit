/**
 * Cliente HTTP da API da Nuvemshop/Tiendanube.
 *
 * - Autenticação pelo cabeçalho `Authentication: bearer <token>` (sim, "Authentication", não "Authorization").
 * - `User-Agent` obrigatório com o nome do app e um contato.
 * - Paginação pelo cabeçalho `Link` (rel="next").
 * - Retry automático em 429 (limite por loja/app) e erros 5xx, respeitando `x-rate-limit-reset`.
 */

export type Region = "br" | "latam";

export interface ClientOptions {
  /** ID da loja (o `user_id` devolvido no OAuth). */
  storeId: number | string;
  /** Token de acesso da loja para o seu app. */
  accessToken: string;
  /** Ex.: "Meu App (contato@meuapp.com)". */
  userAgent: string;
  /** "br" usa api.nuvemshop.com.br; "latam" usa api.tiendanube.com. Padrão: "br". */
  region?: Region;
  /** Versão da API no caminho. Padrão: "v1". */
  apiVersion?: string;
  /** Número máximo de novas tentativas em 429/5xx. Padrão: 4. */
  maxRetries?: number;
  /** Implementação de fetch (útil para testes). */
  fetch?: typeof fetch;
  /** Função de espera (útil para testes). */
  sleep?: (ms: number) => Promise<void>;
}

export class NuvemshopError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "NuvemshopError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

const HOSTS: Record<Region, string> = {
  br: "https://api.nuvemshop.com.br",
  latam: "https://api.tiendanube.com",
};

export class NuvemshopClient {
  readonly baseUrl: string;
  private readonly opts: Required<Omit<ClientOptions, "region" | "apiVersion">>;

  constructor(options: ClientOptions) {
    if (!options.userAgent) throw new Error("userAgent é obrigatório (ex.: 'Meu App (contato@meuapp.com)')");
    this.baseUrl = `${HOSTS[options.region ?? "br"]}/${options.apiVersion ?? "v1"}/${options.storeId}`;
    this.opts = {
      storeId: options.storeId,
      accessToken: options.accessToken,
      userAgent: options.userAgent,
      maxRetries: options.maxRetries ?? 4,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  url(path: string, query?: Query): string {
    const u = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  /** Faz uma requisição e devolve o JSON e os cabeçalhos. */
  async raw<T>(method: string, pathOrUrl: string, body?: unknown, query?: Query): Promise<{ data: T; headers: Headers }> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : this.url(pathOrUrl, query);
    for (let attempt = 0; ; attempt++) {
      const res = await this.opts.fetch(url, {
        method,
        headers: {
          Authentication: `bearer ${this.opts.accessToken}`,
          "User-Agent": this.opts.userAgent,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if ((res.status === 429 || res.status >= 500) && attempt < this.opts.maxRetries) {
        await this.opts.sleep(retryDelay(res.headers, attempt));
        continue;
      }

      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) {
        const msg = (data as { description?: string; message?: string } | null)?.description
          ?? (data as { message?: string } | null)?.message
          ?? res.statusText;
        throw new NuvemshopError(`${method} ${url} → ${res.status}: ${msg}`, res.status, data);
      }
      return { data: data as T, headers: res.headers };
    }
  }

  async get<T>(path: string, query?: Query): Promise<T> { return (await this.raw<T>("GET", path, undefined, query)).data; }
  async post<T>(path: string, body: unknown): Promise<T> { return (await this.raw<T>("POST", path, body)).data; }
  async put<T>(path: string, body: unknown): Promise<T> { return (await this.raw<T>("PUT", path, body)).data; }
  async delete<T = unknown>(path: string): Promise<T> { return (await this.raw<T>("DELETE", path)).data; }

  /** Percorre todas as páginas de uma listagem (até 200 itens por página). */
  async *paginate<T>(path: string, query: Query = {}): AsyncGenerator<T> {
    let next: string | null = this.url(path, { per_page: 200, ...query });
    while (next) {
      const { data, headers }: { data: T[]; headers: Headers } = await this.raw<T[]>("GET", next);
      for (const item of data ?? []) yield item;
      next = nextLink(headers.get("link"));
    }
  }

  /** Busca todas as páginas e devolve um array. */
  async all<T>(path: string, query: Query = {}): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.paginate<T>(path, query)) out.push(item);
    return out;
  }
}

export function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1];
  }
  return null;
}

export function retryDelay(headers: Headers, attempt: number): number {
  const reset = Number(headers.get("x-rate-limit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.min(reset, 10_000);
  return Math.min(500 * 2 ** attempt, 8_000);
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
