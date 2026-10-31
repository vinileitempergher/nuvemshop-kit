import { createHmac, timingSafeEqual } from "node:crypto";

/** Nome do cabeçalho com a assinatura enviada pela Nuvemshop. */
export const SIGNATURE_HEADER = "x-linkedstore-hmac-sha256";

/**
 * Verifica a assinatura de um webhook.
 *
 * A Nuvemshop assina o corpo BRUTO da requisição com HMAC-SHA256 usando o client secret do app
 * e envia o resultado em hexadecimal no cabeçalho `x-linkedstore-hmac-sha256`.
 * Calcule sobre os bytes exatos recebidos, antes de fazer `JSON.parse`.
 */
export function verifyWebhook(rawBody: string | Uint8Array, signature: string | null | undefined, clientSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Corpo "magro" enviado nos webhooks de recurso (ex.: order/paid). Busque o recurso completo pela API. */
export interface WebhookEvent {
  store_id: number;
  event: string;
  id?: number;
  [key: string]: unknown;
}

/** Eventos de LGPD exigidos na homologação de apps desenvolvidos no Brasil. */
export const LGPD_EVENTS = ["store/redact", "customers/redact", "customers/data_request"] as const;
export type LgpdEvent = (typeof LGPD_EVENTS)[number];

export interface StoreRedactPayload { store_id: number }
export interface CustomersRedactPayload {
  store_id: number;
  customer: { id: number; email?: string; phone?: string; identification?: string };
  orders_to_redact?: number[];
}
export interface CustomersDataRequestPayload {
  store_id: number;
  customer: { id: number; email?: string; phone?: string; identification?: string };
  orders_requested?: number[];
  data_request?: { id: number };
}

export interface LgpdHandlers {
  /** Apague todos os dados da loja (enviado após a desinstalação). */
  storeRedact(payload: StoreRedactPayload): Promise<void> | void;
  /** Apague os dados pessoais do cliente indicado. */
  customersRedact(payload: CustomersRedactPayload): Promise<void> | void;
  /** Reúna e entregue os dados que o app guarda sobre o cliente. */
  customersDataRequest(payload: CustomersDataRequestPayload): Promise<void> | void;
}

/**
 * Cria um handler único para os três webhooks LGPD.
 * Devolve o status HTTP a responder (responda rápido: a Nuvemshop espera 2xx em poucos segundos).
 */
export function createLgpdHandler(clientSecret: string, handlers: LgpdHandlers) {
  return async function handle(event: LgpdEvent, rawBody: string, signature: string | null | undefined): Promise<number> {
    if (!verifyWebhook(rawBody, signature, clientSecret)) return 401;
    const payload = JSON.parse(rawBody);
    switch (event) {
      case "store/redact": await handlers.storeRedact(payload); break;
      case "customers/redact": await handlers.customersRedact(payload); break;
      case "customers/data_request": await handlers.customersDataRequest(payload); break;
      default: return 400;
    }
    return 200;
  };
}
