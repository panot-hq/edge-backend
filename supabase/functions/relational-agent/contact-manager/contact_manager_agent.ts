import { createAgent, tool } from "langchain";
import { traceable } from "langsmith/traceable";
import { llm } from "../lib/llm_provider.ts";
import { z } from "zod";

import {
  create_contact,
  get_contact_data,
  update_contact_details,
} from "./tools.ts";

import { CONTACT_PROMPT } from "./prompt.ts";

const contact_agent = createAgent({
  model: llm as any,
  tools: [
    create_contact,
    get_contact_data,
    update_contact_details,
  ],
  systemPrompt: CONTACT_PROMPT,
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

    if (result.messages && result.messages.length > 0) {
      const lastMessage = result.messages[result.messages.length - 1];
      return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }
    return "OK";
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
    - El node_id y contact_id es NECESARIO para manageContextGraph

    LEER/ACTUALIZAR (con contact_id):
    - Obtiene datos básicos incluyendo node_id y contact_id
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
    }),
  },
);

export { manageContact };
