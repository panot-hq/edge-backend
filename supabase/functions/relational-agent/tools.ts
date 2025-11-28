import { z } from "zod";
import { tool } from "langchain";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export const get_contact_data = tool(
  async ({ contact_id }: { contact_id: string }) => {
    try {
      const { data, error } = await supabase.from("contacts").select("*").eq(
        "id",
        contact_id,
      ).maybeSingle();

      if (error) {
        console.error("[get_contact_data] Error:", error.message);
        throw new Error(error.message);
      }
      if (!data) {
        return `No contact found with ID: ${contact_id}`;
      }
      return JSON.stringify(data);
    } catch (error) {
      console.error("[get_contact_data] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "get_contact_details",
    description:
      "Obtiene los detalles básicos de un contacto: nombre (first_name, last_name), canales de comunicación (communication_channels como email, teléfono), y detalles personales básicos (details). Usa esta tool cuando necesites información de contacto básica, nombre completo, o formas de comunicarse con la persona. NO contiene intereses ni relaciones semánticas.",
    schema: z.object({
      contact_id: z.string().describe(
        "El UUID del contacto. Si está en el contexto del mensaje del usuario, úsalo directamente.",
      ),
    }),
  },
);

export const get_contact_context_from_graph = tool(
  async ({ contact_id }: { contact_id: string }) => {
    try {
      // source_id es el contact_id, target_id es el semantic_node_id
      const { data, error } = await supabase.from("semantic_edges").select(
        `
          id,
          relation_type,
          weight,
          created_at,
          semantic_nodes!semantic_edges_target_id_fkey (
            id,
            label,
            type
          )
        `,
      ).eq("source_id", contact_id);

      if (error) {
        console.error("[get_contact_context_from_graph] Error:", error.message);
        throw new Error(error.message);
      }
      if (!data || data.length === 0) {
        return `No hay información contextual o intereses registrados en el grafo para el contacto con ID: ${contact_id}`;
      }
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error("[get_contact_context_from_graph] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "get_contact_context_from_graph",
    description:
      "Obtiene el contexto semántico y relacional del contacto desde el grafo de conocimiento. Esto incluye: intereses, hobbies, temas de conversación, relaciones con otros conceptos, y cualquier información contextual extraída de interacciones previas. Los datos vienen como nodos semánticos (semantic_nodes) conectados al contacto a través de edges. USA ESTA TOOL cuando el usuario pregunte por: intereses, temas, hobbies, relaciones, contexto social, o cualquier cosa que no sea información básica de contacto.",
    schema: z.object({
      contact_id: z.string().describe(
        "El UUID del contacto. Si está en el contexto del mensaje del usuario, úsalo directamente.",
      ),
    }),
  },
);
