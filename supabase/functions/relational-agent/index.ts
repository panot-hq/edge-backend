import { panot_orchestrator } from "./panot_os.ts";
import { traceable } from "langsmith/traceable";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const handleRequest = traceable(
  async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders,
      });
    }
    try {
      const { transcript, mode, user_id, contact_id, node_id } = await req
        .json();

      if (!transcript) {
        return new Response("Please provide a 'transcript'", { status: 400 });
      }
      if (
        !mode ||
        !["CONVERSATIONAL", "ACTIONABLE", "CONTACT_DETAILS_UPDATE"].includes(
          mode,
        )
      ) {
        return new Response("Please provide a 'mode'", { status: 400 });
      }
      if (!user_id) {
        return new Response("Please provide a 'user_id'", { status: 400 });
      }

      let contextMessage = transcript;
      const contextParts: string[] = [];

      if (user_id) contextParts.push(`user_id="${user_id}"`);
      if (contact_id) contextParts.push(`contact_id="${contact_id}"`);
      if (node_id) contextParts.push(`node_id="${node_id}"`);

      if (contextParts.length > 0) {
        contextMessage = `[CONTEXT: ${
          contextParts.join(", ")
        }]\n\n${transcript}`;
      }

      contextMessage = `[MODE: ${mode}]\n\n${contextMessage}`;

      const response = await traceable(
        async () => {
          return await panot_orchestrator.invoke({
            messages: [{ role: "user", content: contextMessage }],
          });
        },
        {
          name: "panot_orchestrator_invoke",
          tags: ["orchestrator", "agent"],
          metadata: {
            user_id,
            contact_id: contact_id || "none",
            node_id: node_id || "none",
            mode,
            transcript_length: transcript.length,
          },
        },
      )();

      const lastMessage = response.messages[response.messages.length - 1];

      if (mode === "ACTIONABLE" || mode === "CONTACT_DETAILS_UPDATE") {
        const content = lastMessage.content as string;
        if (content.includes("OK") || content.includes("ERROR:")) {
          return new Response(
            JSON.stringify({ status: content }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ status: "OK" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
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
  },
  {
    name: "relational_agent_request",
    tags: ["http", "main"],
    metadata: { function: "edge-function" },
  },
);

Deno.serve(handleRequest);
