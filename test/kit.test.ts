import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NuvemshopClient, NuvemshopError, nextLink, authorizeUrl, exchangeCode, verifyWebhook, createLgpdHandler, resources } from "../src/index.js";

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: [] };
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const base = { storeId: 789, accessToken: "tok", userAgent: "Teste (t@t.com)", sleep: async () => {} };

test("envia cabeçalhos de autenticação e User-Agent", async () => {
  const { f, calls } = fakeFetch([{ body: { id: 1 } }]);
  const c = new NuvemshopClient({ ...base, fetch: f });
  await c.get("/store");
  assert.equal(calls[0].url, "https://api.nuvemshop.com.br/v1/789/store");
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h.Authentication, "bearer tok");
  assert.equal(h["User-Agent"], "Teste (t@t.com)");
});

test("pagina seguindo o cabeçalho Link", async () => {
  const next = "https://api.nuvemshop.com.br/v1/789/orders?page=2&per_page=200";
  const { f, calls } = fakeFetch([
    { body: [{ id: 1 }, { id: 2 }], headers: { link: `<${next}>; rel="next", <x>; rel="last"` } },
    { body: [{ id: 3 }] },
  ]);
  const c = new NuvemshopClient({ ...base, fetch: f });
  const all = await c.all<{ id: number }>("/orders");
  assert.deepEqual(all.map((o) => o.id), [1, 2, 3]);
  assert.match(calls[0].url, /per_page=200/);
  assert.equal(calls[1].url, next);
});

test("tenta de novo em 429 e depois devolve os dados", async () => {
  const waits: number[] = [];
  const { f, calls } = fakeFetch([{ status: 429, headers: { "x-rate-limit-reset": "1200" } }, { body: { ok: true } }]);
  const c = new NuvemshopClient({ ...base, fetch: f, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await c.get("/store"), { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [1200]);
});

test("lança NuvemshopError em erro 4xx", async () => {
  const { f } = fakeFetch([{ status: 422, body: { description: "code inválido" } }]);
  const c = new NuvemshopClient({ ...base, fetch: f });
  await assert.rejects(c.post("/coupons", {}), (e: unknown) => e instanceof NuvemshopError && e.status === 422 && /code inválido/.test(e.message));
});

test("nextLink lida com ausência de próxima página", () => {
  assert.equal(nextLink(null), null);
  assert.equal(nextLink('<a>; rel="last"'), null);
});

test("authorizeUrl e exchangeCode", async () => {
  assert.equal(authorizeUrl(123, "abc"), "https://www.nuvemshop.com.br/apps/123/authorize?state=abc");
  const { f, calls } = fakeFetch([{ body: { access_token: "t", token_type: "bearer", scope: "read_orders", user_id: "789" } }]);
  const tok = await exchangeCode({ clientId: 123, clientSecret: "s", code: "xyz", fetch: f });
  assert.equal(tok.user_id, "789");
  assert.equal(calls[0].url, "https://www.nuvemshop.com.br/apps/authorize/token");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { client_id: "123", client_secret: "s", grant_type: "authorization_code", code: "xyz" });
});

test("verifyWebhook aceita assinatura correta e recusa a errada", () => {
  const body = JSON.stringify({ store_id: 789, event: "order/paid", id: 5 });
  const sig = createHmac("sha256", "segredo").update(body).digest("hex");
  assert.equal(verifyWebhook(body, sig, "segredo"), true);
  assert.equal(verifyWebhook(body, sig, "outro"), false);
  assert.equal(verifyWebhook(body, undefined, "segredo"), false);
});

test("handler LGPD despacha o evento e recusa assinatura inválida", async () => {
  const seen: string[] = [];
  const handle = createLgpdHandler("segredo", {
    storeRedact: (p) => { seen.push(`store:${p.store_id}`); },
    customersRedact: (p) => { seen.push(`cust:${p.customer.id}`); },
    customersDataRequest: () => { seen.push("data"); },
  });
  const body = JSON.stringify({ store_id: 789, customer: { id: 9 } });
  const sig = createHmac("sha256", "segredo").update(body).digest("hex");
  assert.equal(await handle("customers/redact", body, sig), 200);
  assert.equal(await handle("customers/redact", body, "x"), 401);
  assert.deepEqual(seen, ["cust:9"]);
});

test("webhooks.ensure não duplica inscrições existentes", async () => {
  const { f, calls } = fakeFetch([
    { body: [{ id: 1, event: "order/paid", url: "https://app/x" }] },
    { body: { id: 2, event: "order/cancelled", url: "https://app/x" } },
  ]);
  const r = resources(new NuvemshopClient({ ...base, fetch: f }));
  const out = await r.webhooks.ensure([{ event: "order/paid", url: "https://app/x" }, { event: "order/cancelled", url: "https://app/x" }]);
  assert.deepEqual(out.map((w) => w.id), [1, 2]);
  assert.equal(calls.filter((c) => c.init.method === "POST").length, 1);
});
