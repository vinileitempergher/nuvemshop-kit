import type { NuvemshopClient } from "./client.js";

/** Campos multilíngues da API vêm como { pt: "...", es: "..." }. */
export type I18n = Partial<Record<"pt" | "es" | "en", string>>;

export interface Coupon {
  id: number;
  code: string;
  type: "percentage" | "absolute" | "shipping";
  value: string;
  valid?: boolean;
  used?: number;
  max_uses?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  min_price?: string | null;
  first_consumer_purchase?: boolean;
  combines_with_other_discounts?: boolean;
  [key: string]: unknown;
}
export type CouponInput = Pick<Coupon, "code" | "type" | "value"> & Partial<Omit<Coupon, "id">>;

export interface Order {
  id: number;
  number: number;
  status: "open" | "closed" | "cancelled";
  payment_status: string;
  currency: string;
  subtotal: string;
  total: string;
  discount?: string;
  shipping_cost_customer?: string;
  coupon?: Array<{ id: number; code: string; type: string; value: string }>;
  customer?: { id: number; name?: string; email?: string };
  created_at: string;
  paid_at?: string | null;
  cancelled_at?: string | null;
  [key: string]: unknown;
}

export interface Webhook { id: number; event: string; url: string; created_at?: string; updated_at?: string }

export interface Script {
  id: number;
  src: string;
  event: "onload" | "onfirstinteraction";
  where: string;
  created_at?: string;
  updated_at?: string;
}

export interface Product {
  id: number;
  name: I18n;
  handle?: I18n;
  published?: boolean;
  variants?: Array<{ id: number; price: string; stock: number | null; sku?: string | null }>;
  [key: string]: unknown;
}

/** Atalhos tipados para os recursos mais usados. */
export function resources(client: NuvemshopClient) {
  return {
    store: {
      get: () => client.get<Record<string, unknown>>("/store"),
    },
    coupons: {
      list: (query?: Record<string, string | number>) => client.all<Coupon>("/coupons", query),
      get: (id: number) => client.get<Coupon>(`/coupons/${id}`),
      create: (input: CouponInput) => client.post<Coupon>("/coupons", input),
      update: (id: number, input: Partial<CouponInput>) => client.put<Coupon>(`/coupons/${id}`, input),
      delete: (id: number) => client.delete(`/coupons/${id}`),
    },
    orders: {
      list: (query?: Record<string, string | number>) => client.all<Order>("/orders", query),
      get: (id: number) => client.get<Order>(`/orders/${id}`),
    },
    products: {
      list: (query?: Record<string, string | number>) => client.all<Product>("/products", query),
      get: (id: number) => client.get<Product>(`/products/${id}`),
    },
    webhooks: {
      list: () => client.all<Webhook>("/webhooks"),
      create: (event: string, url: string) => client.post<Webhook>("/webhooks", { event, url }),
      delete: (id: number) => client.delete(`/webhooks/${id}`),
      /** Garante que cada evento esteja registrado apontando para a URL dada (idempotente). */
      async ensure(subscriptions: Array<{ event: string; url: string }>): Promise<Webhook[]> {
        const existing = await client.all<Webhook>("/webhooks");
        const out: Webhook[] = [];
        for (const sub of subscriptions) {
          const same = existing.find((w) => w.event === sub.event && w.url === sub.url);
          out.push(same ?? (await client.post<Webhook>("/webhooks", sub)));
        }
        return out;
      },
    },
    scripts: {
      list: () => client.all<Script>("/scripts"),
      create: (input: { src: string; event?: Script["event"]; where?: string }) =>
        client.post<Script>("/scripts", { event: "onload", where: "store", ...input }),
      delete: (id: number) => client.delete(`/scripts/${id}`),
    },
  };
}
