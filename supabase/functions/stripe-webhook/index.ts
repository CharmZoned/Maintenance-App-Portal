/**
 * LD-27: Stripe webhook → PaymentProcessorEvents (+ settle on success).
 * Without STRIPE_WEBHOOK_SECRET, rejects (safe no-op deploy).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response(
      JSON.stringify({ error: "STRIPE_WEBHOOK_SECRET not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const payload = await req.text();
  const sigHeader = req.headers.get("stripe-signature") ?? "";
  // Lightweight verification: require v1 signature match for timestamped payload.
  // Production should use Stripe's official tolerance window; this blocks unsigned posts.
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    }),
  );
  const signed = `${parts.t}.${payload}`;
  const expected = await hmacSha256Hex(webhookSecret, signed);
  if (!parts.v1 || parts.v1 !== expected) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = JSON.parse(payload) as {
    id: string;
    type: string;
    data?: { object?: Record<string, unknown> };
  };

  const obj = event.data?.object ?? {};
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const intentId = meta.payment_intent_id
    ? Number(meta.payment_intent_id)
    : null;
  const settle = event.type === "payment_intent.succeeded";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.rpc(
    "record_processor_event_and_settle",
    {
      p_provider: "stripe",
      p_event_id: event.id,
      p_event_type: event.type,
      p_payload: event,
      p_intent_id: intentId,
      p_settle: settle,
      p_reference: typeof obj.id === "string" ? obj.id : null,
    },
  );

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, event: data }), {
    headers: { "Content-Type": "application/json" },
  });
});
