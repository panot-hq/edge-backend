import { z } from "zod";
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { traceable } from "langsmith/traceable";

import {
  add_info_to_contact_graph,
  batch_add_info_to_graph,
  create_concept_relationship,
  create_contact,
  create_semantic_edge,
  delete_semantic_edge,
  find_shared_connections_for_contact,
  get_contact_connections_from_node,
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
    add_info_to_contact_graph,
    batch_add_info_to_graph,
    get_contact_context_from_graph,
    find_shared_connections_for_contact,
    get_contact_connections_from_node,
    create_concept_relationship,
    update_edge_weight,
    delete_semantic_edge,
    search_semantic_nodes,
    upsert_semantic_node,
    create_semantic_edge,
  ],
  systemPrompt: CONTEXT_GRAPH_PROMPT,
});

const manageContactFn = traceable(
  async (
    { user_id, contact_id, request, mode }: {
      user_id: string;
      contact_id?: string;
      request: string;
      mode: string;
    },
  ) => {
    let contextStr = `user_id="${user_id}"`;
    if (contact_id) {
      contextStr += `, contact_id="${contact_id}"`;
    }

    const result = await contact_agent.invoke({
      messages: [{
        role: "user",
        content: `[CONTEXT: ${contextStr}][MODE: ${mode}]\n\nTarea: ${request}`,
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
    description: `Gestiona contactos: CREAR nuevos o LEER/ACTUALIZAR existentes.

CREAR (sin contact_id):
- Retorna: { contact_id, node_id } 
- El node_id es NECESARIO para manageContextGraph

LEER/ACTUALIZAR (con contact_id):
- Obtiene datos básicos incluyendo node_id
- Actualiza nombre, apellido, canales de comunicación`,
    schema: z.object({
      user_id: z.string().describe(
        "El UUID del usuario propietario (siempre requerido)",
      ),
      contact_id: z.string().optional().describe(
        "El UUID del contacto (solo para leer/actualizar, no para crear)",
      ),
      request: z.string().describe(
        "La solicitud: crear, consultar, o actualizar datos básicos",
      ),
      mode: z.string().describe(
        "El modo de operación: CONVERSATIONAL, ACTIONABLE, CONTACT_DETAILS_UPDATE",
      ),
    }),
  },
);

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
    const modeWarning = mode === "CONTACT_DETAILS_UPDATE"
      ? "\n\n MODO CRÍTICO: CONTACT_DETAILS_UPDATE DETECTADO\n→ DEBES usar skip_details_regeneration: true en TODAS las herramientas\n→ BAJO NINGÚN CONCEPTO actualices el campo 'details'\n"
      : "";

    const result = await context_graph_agent.invoke({
      messages: [{
        role: "user",
        content:
          `[CONTEXT: node_id="${node_id}", contact_id="${contact_id}", user_id="${user_id}"]${modeWarning}\n\nTarea: ${request}`,
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

const tools = [manageContact, manageContextGraph];

export const panot_orchestrator = createAgent({
  model: llm.model,
  tools: tools,
  systemPrompt: ORCHESTRATOR_PROMPT,
});
