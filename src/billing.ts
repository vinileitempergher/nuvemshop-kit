import type { NuvemshopClient } from "./client.js";

/**
 * Cobrança de apps pela Nuvemshop (Billing API).
 *
 * - Só existe nas versões datadas da API (ex.: `apiVersion: "2025-03"`), não na v1.
 * - A assinatura é criada sozinha quando o lojista instala um app com mensalidade configurada
 *   no Portal de Parceiros. Não há endpoint para criá-la.
 * - Para apps, `concept_code` é sempre `"app-cost"` e `service_id` é o ID do app.
 * - Escopos: read_subscriptions, write_subscriptions, write_charges (e write_plans para planos).
 * - Se o lojista não paga, a Nuvemshop suspende o acesso do app à API da loja e envia `app/suspended`.
 */
export const APP_COST = "app-cost";

/** Eventos de webhook ligados à cobrança/ciclo de vida do app. */
export const BILLING_EVENTS = ["app/suspended", "app/resumed", "app_subscription/updated"] as const;

export interface Subscription {
  id?: string;
  amount_value?: number | string;
  amount_currency?: string;
  next_execution?: string;
  plan?: { id: string; code?: string; external_reference?: string } | null;
  [key: string]: unknown;
}

export interface SubscriptionUpdate {
  plan_id?: string;
  plan_external_id?: string;
  amount_value?: number;
  amount_currency?: string;
}

export interface ChargeInput {
  description: string;
  from_date: string;
  to_date: string;
  amount_value: number;
  amount_currency: string;
  external_reference?: string;
  concept_code?: string;
}

/** Payload do webhook `app_subscription/updated`. */
export interface AppSubscriptionUpdated {
  store_id: number;
  event: "app_subscription/updated";
  id: number;
  topic: "churn" | "phoenix" | "plan_changed";
  plan?: { id: string; code?: string; external_reference?: string };
}

/** Situação da assinatura que um app costuma guardar por loja. */
export type BillingStatus = "active" | "suspended" | "churned";

/**
 * Converte um evento de webhook na nova situação de cobrança da loja.
 * Devolve `null` quando o evento não muda a situação.
 */
export function billingTransition(evt: { event: string; topic?: string; plan?: { code?: string } }):
  { status?: BillingStatus; planCode?: string | null } | null {
  switch (evt.event) {
    case "app/suspended": return { status: "suspended" };
    case "app/resumed": return { status: "active" };
    case "app_subscription/updated":
      if (evt.topic === "churn") return { status: "churned" };
      if (evt.topic === "phoenix") return { status: "active", planCode: evt.plan?.code ?? null };
      if (evt.topic === "plan_changed") return { planCode: evt.plan?.code ?? null };
      return null;
    default: return null;
  }
}

/** Atalhos da Billing API. O `client` precisa ter sido criado com uma versão datada (ex.: "2025-03"). */
export function billing(client: NuvemshopClient, appId: number | string) {
  const sub = `/concepts/${APP_COST}/services/${appId}/subscriptions`;
  return {
    /** Assinatura da loja. Lança NuvemshopError 404 se o app for gratuito ou a cobrança ainda não estiver ativa. */
    subscription: () => client.get<Subscription>(sub),
    updateSubscription: (body: SubscriptionUpdate) => client.raw<Subscription>("PATCH", sub, body).then((r) => r.data),
    /** Cobrança extra (uso variável). Recomenda-se criar 1 dia antes do `next_execution`. */
    createCharge: (input: ChargeInput) =>
      client.post(`/services/${appId}/charges`, { concept_code: APP_COST, ...input }),
  };
}
