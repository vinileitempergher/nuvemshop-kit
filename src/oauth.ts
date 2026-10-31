/**
 * OAuth da Nuvemshop/Tiendanube (fluxo "authorization code").
 *
 * 1. O lojista instala o app (ou acessa a URL de autorização).
 * 2. A Nuvemshop redireciona para a sua Redirect URL com `?code=...` (o código expira em minutos).
 * 3. Você troca o código por um `access_token` + `user_id` (= ID da loja) com `exchangeCode`.
 *
 * Os tokens não expiram: deixam de valer quando um novo é gerado ou o app é desinstalado.
 */

export type Domain = "nuvemshop" | "tiendanube";

const AUTH_BASE: Record<Domain, string> = {
  nuvemshop: "https://www.nuvemshop.com.br/apps",
  tiendanube: "https://www.tiendanube.com/apps",
};

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  /** ID da loja. */
  user_id: string | number;
}

/** URL para iniciar a instalação/autorização do app. Use `state` contra CSRF. */
export function authorizeUrl(appId: string | number, state?: string, domain: Domain = "nuvemshop"): string {
  const u = new URL(`${AUTH_BASE[domain]}/${appId}/authorize`);
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

export interface ExchangeOptions {
  clientId: string | number;
  clientSecret: string;
  code: string;
  domain?: Domain;
  fetch?: typeof fetch;
}

/** Troca o `code` recebido na Redirect URL por um token de acesso. */
export async function exchangeCode(opts: ExchangeOptions): Promise<TokenResponse> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const res = await f(`${AUTH_BASE[opts.domain ?? "nuvemshop"]}/authorize/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // O corpo precisa ir em JSON (não como query string).
    body: JSON.stringify({
      client_id: String(opts.clientId),
      client_secret: opts.clientSecret,
      grant_type: "authorization_code",
      code: opts.code,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(`Falha ao trocar o code por token: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data as TokenResponse;
}
