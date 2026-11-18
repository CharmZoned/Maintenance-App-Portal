/**
 * LD-27: Create / attach a tenant payment intent.
 * Stripe PI is created once; retries retrieve the existing client_secret.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json() as {
      charge_id?: number;
      amount?: number;
      method?: "card" | "ach" | "zelle";
      intent_id?: number;
    };

    let intent: Record<string, unknown> | null = null;

    if (body.intent_id) {
      const { data, error } = await userClient
        .from("PaymentIntents")
        .select("*")
        .eq("id", body.intent_id)
        .single();
      if (error) throw error;
      intent = data;
    } else {
      if (!body.charge_id || !body.amount || !body.method) {
        return new Response(
          JSON.stringify({ error: "charge_id, amount, and method required" }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      const { data, error } = await userClient.rpc("initiate_tenant_payment", {
        p_charge_id: body.charge_id,
        p_amount: body.amount,
        p_method: body.method,
      });
      if (error) throw error;
      intent = data;
    }

    // Only the owning tenant may create/attach Stripe PaymentIntents.
    const { data: roleRow, error: roleErr } = await userClient
      .from("user_roles")
      .select("tenant_id, role, account_status")
      .eq("user_id", (await userClient.auth.getUser()).data.user?.id ?? "")
      .maybeSingle();
    if (roleErr) throw roleErr;
    if (
      roleRow?.role !== "tenant" ||
      roleRow?.account_status !== "approved" ||
      roleRow?.tenant_id == null ||
      Number(roleRow.tenant_id) !== Number(intent?.tenant_id)
    ) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const method = String(intent?.method ?? body.method ?? "");
    const status = String(intent?.status ?? "");

    if (!stripeKey || method === "zelle") {
      return new Response(
        JSON.stringify({
          intent,
          processor_ready: false,
          client_secret: null,
          message: method === "zelle"
            ? "Zelle intent created; use report_zelle_sent after transfer."
            : "Stripe not configured; intent pending for later processor attach.",
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const existingProcessorId = intent?.processor_payment_id
      ? String(intent.processor_payment_id)
      : "";

    // Retry path: retrieve existing Stripe PI — never create a second charge.
    if (existingProcessorId) {
      const stripeRes = await fetch(
        `https://api.stripe.com/v1/payment_intents/${existingProcessorId}`,
        {
          headers: { Authorization: `Bearer ${stripeKey}` },
        },
      );
      const stripeJson = await stripeRes.json();
      if (!stripeRes.ok) {
        throw new Error(stripeJson?.error?.message ?? "Stripe retrieve failed");
      }
      return new Response(
        JSON.stringify({
          intent,
          processor_ready: true,
          client_secret: stripeJson.client_secret ?? null,
          reused: true,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (status !== "pending") {
      return new Response(
        JSON.stringify({
          error: `Cannot create Stripe PaymentIntent from status ${status}`,
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const amountCents = Math.round(Number(intent!.amount) * 100);
    const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(amountCents),
        currency: Deno.env.get("STRIPE_CURRENCY") ?? "usd",
        "metadata[payment_intent_id]": String(intent!.id),
        "metadata[charge_id]": String(intent!.charge_id),
        payment_method_types: method === "ach" ? "us_bank_account" : "card",
      }),
    });

    const stripeJson = await stripeRes.json();
    if (!stripeRes.ok) {
      throw new Error(stripeJson?.error?.message ?? "Stripe create failed");
    }

    const { data: attached, error: attachErr } = await userClient.rpc(
      "attach_payment_intent_processor_id",
      {
        p_intent_id: intent!.id,
        p_processor_payment_id: stripeJson.id,
        p_status: "processing",
      },
    );
    if (attachErr) throw attachErr;

    return new Response(
      JSON.stringify({
        intent: attached,
        processor_ready: true,
        client_secret: stripeJson.client_secret ?? null,
        reused: false,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
