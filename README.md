# nuvemshop-kit

Kit em **TypeScript** para quem cria apps para a **Nuvemshop / Tiendanube**: um cliente da API com paginação e *retry*, OAuth, verificação de webhooks e handlers prontos para a **LGPD**.

Não existe um SDK oficial em Node para a API REST da Nuvemshop, então quem cria um app acaba reescrevendo as mesmas peças: autenticação, paginação, limites de requisição, assinatura de webhooks e os webhooks de LGPD exigidos na homologação. Este kit reúne essas peças, testadas e sem nenhuma dependência em tempo de execução.

> Projeto independente, sem vínculo com a Nuvemshop/Tiendanube.

## O que tem

| Módulo | O que resolve |
|---|---|
| `NuvemshopClient` | Requisições autenticadas, `User-Agent` obrigatório, paginação pelo cabeçalho `Link` (até 200 itens/página) e nova tentativa automática em `429`/`5xx` respeitando `x-rate-limit-reset` |
| `resources()` | Atalhos tipados para loja, cupons, pedidos, produtos, webhooks (com `ensure` idempotente) e scripts da vitrine |
| `authorizeUrl` / `exchangeCode` | Fluxo OAuth (authorization code) para instalar o app e obter o token da loja |
| `verifyWebhook` | Validação do `x-linkedstore-hmac-sha256` (HMAC-SHA256 do corpo bruto com o client secret), com comparação em tempo constante |
| `createLgpdHandler` | Um handler para `store/redact`, `customers/redact` e `customers/data_request` |
| `billing()` / `billingTransition` | Billing API (assinatura do app, troca de plano, cobranças extras) e tradução de `app/suspended`, `app/resumed` e `app_subscription/updated` na situação da assinatura |

## Instalação

```bash
npm install github:vinileitempergher/nuvemshop-kit
```

Requer Node 18 ou mais recente (usa o `fetch` nativo).

## Uso rápido

```ts
import { NuvemshopClient, resources } from "nuvemshop-kit";

const client = new NuvemshopClient({
  storeId: 123456,              // user_id recebido no OAuth
  accessToken: process.env.NUVEMSHOP_TOKEN!,
  userAgent: "Meu App (contato@meuapp.com)",
});
const api = resources(client);

// Todos os pedidos pagos, percorrendo as páginas automaticamente
const pedidos = await api.orders.list({ payment_status: "paid" });

// Cupom para um afiliado
await api.coupons.create({ code: "MARIA10", type: "percentage", value: "10" });

// Garante os webhooks sem duplicar inscrições
await api.webhooks.ensure([
  { event: "order/paid", url: "https://meuapp.com/webhooks" },
  { event: "app/uninstalled", url: "https://meuapp.com/webhooks" },
]);
```

### Instalação do app (OAuth)

```ts
import { authorizeUrl, exchangeCode } from "nuvemshop-kit";

// 1. Link para instalar
authorizeUrl(process.env.APP_ID!, "token-anti-csrf");

// 2. Na sua Redirect URL, troque o ?code= por um token
const { access_token, user_id } = await exchangeCode({
  clientId: process.env.APP_ID!,
  clientSecret: process.env.APP_SECRET!,
  code,
});
```

### Webhooks e LGPD

```ts
import { verifyWebhook, createLgpdHandler } from "nuvemshop-kit";

// Use o corpo BRUTO, antes do JSON.parse
const ok = verifyWebhook(rawBody, req.headers["x-linkedstore-hmac-sha256"], process.env.APP_SECRET!);

const lgpd = createLgpdHandler(process.env.APP_SECRET!, {
  storeRedact: async ({ store_id }) => { /* apagar dados da loja */ },
  customersRedact: async ({ store_id, customer }) => { /* apagar dados do cliente */ },
  customersDataRequest: async ({ store_id, customer }) => { /* reunir dados do cliente */ },
});
```

Veja um servidor completo, sem dependências, em [`examples/server.ts`](examples/server.ts).

### Cobrança pela Nuvemshop (Billing API)

A assinatura é criada pela própria Nuvemshop quando o lojista instala um app com mensalidade configurada no Portal de Parceiros. O app só precisa saber se a loja está em dia:

```ts
import { NuvemshopClient, billing, billingTransition } from "nuvemshop-kit";

// No webhook: app/suspended, app/resumed e app_subscription/updated
const change = billingTransition(evento); // { status: "suspended" } | { status: "active" } | ...

// Consulta (só existe nas versões datadas da API, não na v1)
const c = new NuvemshopClient({ storeId, accessToken, userAgent, apiVersion: "2025-03" });
const assinatura = await billing(c, APP_ID).subscription(); // next_execution, amount_value, plan
```

## Desenvolvimento

```bash
npm install
npm test        # testes com node:test
npm run build   # gera dist/
```

## Roadmap

- [x] Cliente com paginação e retry
- [x] OAuth
- [x] Verificação de webhooks + handlers LGPD
- [x] Billing API (cobrança de apps)
- [ ] Mais recursos tipados (clientes, categorias, variantes, estoque)
- [ ] Publicação no npm

## Licença

MIT © Vinícius Leitempergher
