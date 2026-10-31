/**
 * Exemplo mínimo de app Nuvemshop usando só o módulo http do Node.
 *
 *   APP_ID=... APP_SECRET=... PUBLIC_URL=https://seu-dominio npx tsx examples/server.ts
 *
 * Rotas:
 *   GET  /install        → redireciona para a autorização
 *   GET  /oauth/callback → troca o code por token e registra os webhooks
 *   POST /webhooks       → recebe eventos (assinatura verificada)
 *   POST /lgpd/:evento   → store-redact | customers-redact | customers-data-request
 */
import { createServer } from "node:http";
import { NuvemshopClient, resources, authorizeUrl, exchangeCode, verifyWebhook, createLgpdHandler, SIGNATURE_HEADER, type LgpdEvent } from "../src/index.js";

const { APP_ID = "", APP_SECRET = "", PUBLIC_URL = "http://localhost:3000" } = process.env;
const USER_AGENT = `Exemplo nuvemshop-kit (${APP_ID})`;
const tokens = new Map<string, string>(); // em produção: banco de dados

const lgpd = createLgpdHandler(APP_SECRET, {
  storeRedact: ({ store_id }) => { tokens.delete(String(store_id)); },
  customersRedact: () => {},
  customersDataRequest: () => {},
});

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s)); });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", PUBLIC_URL);

  if (url.pathname === "/install") {
    res.writeHead(302, { Location: authorizeUrl(APP_ID, "troque-por-um-state-aleatorio") }).end();
    return;
  }

  if (url.pathname === "/oauth/callback") {
    const { access_token, user_id } = await exchangeCode({ clientId: APP_ID, clientSecret: APP_SECRET, code: url.searchParams.get("code") ?? "" });
    tokens.set(String(user_id), access_token);
    const api = resources(new NuvemshopClient({ storeId: user_id, accessToken: access_token, userAgent: USER_AGENT }));
    await api.webhooks.ensure(["order/paid", "order/cancelled", "app/uninstalled"].map((event) => ({ event, url: `${PUBLIC_URL}/webhooks` })));
    res.end(`App instalado na loja ${user_id}`);
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhooks") {
    const raw = await readBody(req);
    if (!verifyWebhook(raw, req.headers[SIGNATURE_HEADER] as string, APP_SECRET)) { res.writeHead(401).end(); return; }
    res.writeHead(200).end(); // responda rápido e processe depois
    const evt = JSON.parse(raw);
    console.log("evento", evt.event, "loja", evt.store_id, "id", evt.id);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/lgpd/")) {
    const event = url.pathname.slice(6).replace("-", "/").replace("data-request", "data_request") as LgpdEvent;
    const status = await lgpd(event, await readBody(req), req.headers[SIGNATURE_HEADER] as string);
    res.writeHead(status).end();
    return;
  }

  res.writeHead(404).end();
}).listen(3000, () => console.log("ouvindo em :3000"));
