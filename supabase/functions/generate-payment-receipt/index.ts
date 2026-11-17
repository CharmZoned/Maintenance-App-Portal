/**
 * LD-30 stub: register PaymentReceipts metadata for a settled payment.
 * Does not generate a real PDF yet — creates a placeholder path for later upload.
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

    const { payment_id } = await req.json() as { payment_id?: number };
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const storagePath = `receipts/${payment_id}/receipt.pdf`;
    const { data, error } = await supabase
      .from("PaymentReceipts")
      .upsert(
        {
          payment_id,
          storage_path: storagePath,
          file_name: "receipt.pdf",
          content_type: "application/pdf",
          byte_size: null,
        },
        { onConflict: "payment_id" },
      )
      .select()
      .single();

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
