import { agent } from "./panot_os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }
  try {
    const { transcript, mode, user_id, contact_id } = await req.json();

    if (!transcript) {
      return new Response("Please provide a 'transcript'", { status: 400 });
    }
    if (!mode) {
      return new Response("Please provide a 'mode'", { status: 400 });
    }
    if (!user_id) {
      return new Response("Please provide a 'user_id'", { status: 400 });
    }

    let contextMessage = transcript;
    if (contact_id) {
      contextMessage =
        `[CONTEXT: Current contact_id is "${contact_id}"]\n\n${transcript}`;
    }

    const response = await agent.invoke({
      messages: [{ role: "user", content: contextMessage }],
    });

    const lastMessage = response.messages[response.messages.length - 1];

    return new Response(
      JSON.stringify({ answer: lastMessage.content }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
    });
  }
});
