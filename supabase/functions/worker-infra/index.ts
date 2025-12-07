import { call_worker } from "./call_worker.ts";
import { get_user_worker } from "./lib/helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const handleRequest = async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders,
      });
    }

    const { user_id } = await req.json();
    const worker = await get_user_worker(user_id);

    const result = await call_worker(worker);

    return new Response(JSON.stringify({ worker, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
    });
  }
};

Deno.serve(handleRequest);
