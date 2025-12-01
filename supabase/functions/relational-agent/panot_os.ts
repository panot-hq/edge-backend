import { z } from "zod";
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { traceable } from "langsmith/traceable";

import {
  create_contact,
  create_semantic_edge,
  delete_semantic_edge,
  find_shared_connections_for_contact,
  get_contact_connections,
  get_contact_context_from_graph,
  get_contact_data,
  search_semantic_nodes,
  update_contact_details,
  update_edge_weight,
  upsert_semantic_node,
} from "./tools.ts";

import {
  CONTACT_PROMPT,
  CONTEXT_GRAPH_PROMPT,
  ORCHESTRATOR_PROMPT,
} from "./context_prompts.ts";

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const contact_agent = createAgent({
  model: llm.model,
  tools: [
    create_contact,
    get_contact_data,
    update_contact_details,
  ],
  systemPrompt: CONTACT_PROMPT,
});

const context_graph_agent = createAgent({
  model: llm.model,
  tools: [
    get_contact_context_from_graph,
    search_semantic_nodes,
    upsert_semantic_node,
    create_semantic_edge,
    update_edge_weight,
    delete_semantic_edge,
    get_contact_connections,
    find_shared_connections_for_contact,
  ],
  systemPrompt: CONTEXT_GRAPH_PROMPT,
});

const manageContactFn = traceable(
  async (
    { user_id, contact_id, request }: {
      user_id: string;
      contact_id?: string;
      request: string;
    },
  ) => {
    let contextStr = `user_id="${user_id}"`;
    if (contact_id) {
      contextStr += `, contact_id="${contact_id}"`;
    }

    const result = await contact_agent.invoke({
      messages: [{
        role: "user",
        content: `[CONTEXT: ${contextStr}]\n\nTarea: ${request}`,
      }],
    });
    const lastMessage = result.messages[result.messages.length - 1];
    return lastMessage.content;
  },
  {
    name: "manageContact",
    tags: ["agent", "contact"],
    metadata: { agent_type: "contact_agent" },
  },
);

const manageContact = tool(
  manageContactFn,
  {
    name: "manageContact",
    description:
      "Gestiona contactos: CREAR nuevos contactos (requiere user_id), o LEER/ACTUALIZAR contactos existentes (requiere contact_id). Para crear un contacto, solo necesitas user_id. Para leer/actualizar, necesitas contact_id.",
    schema: z.object({
      user_id: z.string().describe(
        "El UUID del usuario propietario de los contactos (siempre requerido)",
      ),
      contact_id: z.string().optional().describe(
        "El UUID del contacto específico (solo para leer/actualizar, no para crear)",
      ),
      request: z.string().describe(
        "La solicitud: crear nuevo contacto, consultar información, o actualizar datos",
      ),
    }),
  },
);

const manageContextGraphFn = traceable(
  async (
    { contact_id, user_id, request }: {
      contact_id: string;
      user_id: string;
      request: string;
    },
  ) => {
    const result = await context_graph_agent.invoke({
      messages: [{
        role: "user",
        content:
          `[CONTEXT: contact_id="${contact_id}", user_id="${user_id}"]\n\nTarea: ${request}`,
      }],
    });
    const lastMessage = result.messages[result.messages.length - 1];
    return lastMessage.content;
  },
  {
    name: "manageContextGraph",
    tags: ["agent", "context_graph"],
    metadata: { agent_type: "context_graph_agent" },
  },
);

const manageContextGraph = tool(
  manageContextGraphFn,
  {
    name: "manageContextGraph",
    description:
      `Gestiona el grafo de conocimiento del contacto: leer contexto, crear/modificar nodos semánticos 
      (intereses, emociones, relaciones), gestionar edges, y descubrir interconexiones entre contactos. 
      Esta herramienta actualiza automáticamente el resumen 'details' del contacto cuando se modifica el grafo.`,
    schema: z.object({
      contact_id: z.string().describe("El UUID del contacto"),
      user_id: z.string().describe("El UUID del usuario propietario"),
      request: z.string().describe(
        "La solicitud para el grafo de conocimiento: consultar, añadir, modificar o eliminar información contextual",
      ),
    }),
  },
);

const tools = [manageContact, manageContextGraph];

export const panot_orchestrator = createAgent({
  model: llm.model,
  tools: tools,
  systemPrompt: ORCHESTRATOR_PROMPT,
});
