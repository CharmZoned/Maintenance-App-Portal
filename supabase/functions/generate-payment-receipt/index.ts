/**
 * LD-30: register PaymentReceipts metadata for a settled payment.
 * Uses the caller JWT + register_payment_receipt RPC (can_select + staff/admin).
 * Does not generate a real PDF yet.
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

    const { payment_id, file_name, content_type, byte_size } = await req.json() as {
      payment_id?: number;
      file_name?: string;
      content_type?: string;
      byte_size?: number | null;
    };
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data, error } = await supabase.rpc("register_payment_receipt", {
      p_payment_id: payment_id,
      p_file_name: file_name ?? "receipt.pdf",
      p_content_type: content_type ?? "application/pdf",
      p_byte_size: byte_size ?? null,
    });
    if (error) throw error;

    return new Response(
      JSON.stringify({
        receipt: data,
        pdf_generated: false,
        message: "Metadata registered; PDF generation not implemented yet.",
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
