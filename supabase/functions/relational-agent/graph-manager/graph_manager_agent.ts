import { createAgent, tool } from "langchain";
import { traceable } from "langsmith/traceable";
import { llm } from "../lib/llm_provider.ts";
import { z } from "zod";

import { CONTEXT_GRAPH_PROMPT } from "./prompt.ts";

import {
  batch_add_info_to_graph,
  delete_semantic_node,
  find_shared_connections_for_contact,
  get_contact_connections_from_node,
  get_contact_context_from_graph,
  search_semantic_nodes,
  upsert_semantic_node,
} from "./tools.ts";

const context_graph_agent = createAgent({
  model: llm as any,
  tools: [
    batch_add_info_to_graph,
    get_contact_context_from_graph,
    find_shared_connections_for_contact,
    get_contact_connections_from_node,
    delete_semantic_node,
    search_semantic_nodes,
    upsert_semantic_node,
  ],
  systemPrompt: CONTEXT_GRAPH_PROMPT,
});

const manageContextGraphFn = traceable(
  async (
    { node_id, contact_id, user_id, request, mode }: {
      node_id: string;
      contact_id: string;
      user_id: string;
      request: string;
      mode: string;
    },
  ) => {
    const result = await context_graph_agent.invoke({
      messages: [{
        role: "user",
        content:
          `[CONTEXT: node_id="${node_id}", contact_id="${contact_id}", user_id="${user_id}, mode="${mode}"]\n\nTarea: ${request}`,
      }],
    });

    if (result.messages && result.messages.length > 0) {
      const lastMessage = result.messages[result.messages.length - 1];
      return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }

    return "OK";
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
    description: `Gestiona el grafo de conocimiento del contacto.

REQUIERE:
- node_id: UUID del nodo CONTACT en semantic_nodes
- contact_id: UUID del contacto en la tabla contacts
- user_id: UUID del usuario propietario

CAPACIDADES:
- Añadir información contextual (intereses, hobbies, emociones, empresas)
- Crear relaciones entre conceptos (ej: "Marco Aurelio" ES_FIGURA_DE "estoicismo")
- Consultar el grafo completo del contacto
- Descubrir INTERCONEXIONES entre contactos
- Modificar/eliminar relaciones existentes

MATCHING INTELIGENTE:
- Para CONCEPTOS (Hobby, Interés): Busca matches semánticos
- Para INSTANCIAS (Universidad, Empresa): NO hace match (UPM ≠ Complutense)`,
    schema: z.object({
      node_id: z.string().describe(
        "El UUID del nodo CONTACT (de semantic_nodes). Obtenerlo de manageContact.",
      ),
      contact_id: z.string().describe(
        "El UUID del contacto (de la tabla contacts). Obtenerlo de manageContact.",
      ),
      user_id: z.string().describe("El UUID del usuario propietario"),
      request: z.string().describe(
        "La solicitud: añadir info, crear relaciones entre conceptos, consultar grafo, buscar interconexiones, o modificar/eliminar",
      ),
      mode: z.string().describe(
        "El modo de operación: CONVERSATIONAL, ACTIONABLE, CONTACT_DETAILS_UPDATE",
      ),
    }),
  },
);

export { manageContextGraph };
