import { z } from "zod";
import { tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";
import { traceable } from "langsmith/traceable";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
  temperature: 0.3,
});

const regenerateContactDetails = traceable(
  async (
    contact_id: string,
    _user_id: string,
  ): Promise<void> => {
    try {
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .select("first_name, last_name")
        .eq("id", contact_id)
        .maybeSingle();

      if (contactError) throw new Error(contactError.message);
      if (!contact) return;

      const { data: edges, error: edgesError } = await supabase
        .from("semantic_edges")
        .select(`
        relation_type,
        weight,
        semantic_nodes!semantic_edges_target_id_fkey (
          label,
          type
        )
      `)
        .eq("source_id", contact_id);

      if (edgesError) throw new Error(edgesError.message);

      if (!edges || edges.length === 0) {
        await supabase
          .from("contacts")
          .update({ details: null })
          .eq("id", contact_id);
        return;
      }

      type EdgeWithNode = {
        relation_type: string;
        weight: number;
        semantic_nodes: { label: string; type: string };
      };

      const graphContext = (edges as unknown as EdgeWithNode[]).map((edge) => {
        const node = edge.semantic_nodes;
        return `- ${edge.relation_type}: ${node.label} (tipo: ${node.type}, intensidad: ${edge.weight})`;
      }).join("\n");

      const prompt =
        `Genera un resumen descriptivo breve (2-4 frases) sobre este contacto basándote en su grafo de contexto.

Contacto: ${contact.first_name} ${contact.last_name}

Grafo de contexto:
${graphContext}

El resumen debe:
- Ser natural y legible para mostrar en una UI
- Incluir información emocional, situacional y de intereses
- Ser conciso pero informativo
- Estar en español

Resumen:`;

      const response = await llm.invoke(prompt);
      const summary = response.content;

      await supabase
        .from("contacts")
        .update({
          details: { summary, updated_at: new Date().toISOString() },
        })
        .eq("id", contact_id);

      console.log(
        `[regenerateContactDetails] Details actualizados para ${contact_id}`,
      );
    } catch (error) {
      console.error("[regenerateContactDetails] Error:", error);
      throw error;
    }
  },
  {
    name: "regenerateContactDetails",
    tags: ["helper", "llm"],
    metadata: { operation: "generate_summary" },
  },
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

export const update_contact_details = tool(
  async (
    { contact_id, first_name, last_name, communication_channels }: {
      contact_id: string;
      first_name?: string;
      last_name?: string;
      communication_channels?: Record<string, string>;
    },
  ) => {
    try {
      const updateData: {
        first_name?: string;
        last_name?: string;
        communication_channels?: Record<string, string>;
      } = {};
      if (first_name !== undefined) updateData.first_name = first_name;
      if (last_name !== undefined) updateData.last_name = last_name;
      if (communication_channels !== undefined) {
        updateData.communication_channels = communication_channels;
      }

      if (Object.keys(updateData).length === 0) {
        return "No se proporcionaron campos para actualizar.";
      }

      const { error } = await supabase
        .from("contacts")
        .update(updateData)
        .eq("id", contact_id);

      if (error) {
        console.error("[update_contact_details] Error:", error.message);
        throw new Error(error.message);
      }

      return `Contacto actualizado correctamente: ${
        JSON.stringify(updateData)
      }`;
    } catch (error) {
      console.error("[update_contact_details] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "update_contact_details",
    description:
      "Actualiza información básica del contacto: nombre (first_name), apellido (last_name), o canales de comunicación (communication_channels como email, teléfono). NO uses esta tool para actualizar el resumen 'details' - ese se genera automáticamente desde el grafo.",
    schema: z.object({
      contact_id: z.string().describe("El UUID del contacto a actualizar"),
      first_name: z.string().optional().describe("Nuevo nombre del contacto"),
      last_name: z.string().optional().describe(
        "Nuevo apellido del contacto",
      ),
      communication_channels: z.record(z.string(), z.string()).optional()
        .describe(
          'Canales de comunicación como objeto JSON: {"email": "...", "phone": "..."}',
        ),
    }),
  },
);

export const search_semantic_nodes = tool(
  async (
    { user_id, type, label_search }: {
      user_id: string;
      type?: string;
      label_search?: string;
    },
  ) => {
    try {
      let query = supabase
        .from("semantic_nodes")
        .select("id, label, type, created_at")
        .eq("user_id", user_id);

      if (type) query = query.eq("type", type);
      if (label_search) query = query.ilike("label", `%${label_search}%`);

      const { data, error } = await query.limit(20);

      if (error) {
        console.error("[search_semantic_nodes] Error:", error.message);
        throw new Error(error.message);
      }

      if (!data || data.length === 0) {
        return "No se encontraron nodos semánticos con esos criterios.";
      }

      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error("[search_semantic_nodes] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "search_semantic_nodes",
    description:
      "Busca nodos semánticos existentes en el grafo del usuario. Usa esta tool ANTES de crear un nuevo nodo para evitar duplicados. Puedes filtrar por tipo (type) como 'Empresa', 'Interés', 'Emoción', etc., y por etiqueta (label_search) para búsqueda parcial. Retorna máximo 20 resultados.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario del grafo"),
      type: z.string().optional().describe(
        "Filtrar por tipo de nodo: Empresa, Interés, Emoción, Hobby, etc.",
      ),
      label_search: z.string().optional().describe(
        "Búsqueda parcial en la etiqueta del nodo (ej: 'tecnolog' encuentra 'startup tecnológica')",
      ),
    }),
  },
);

export const upsert_semantic_node = tool(
  async (
    { user_id, label, type }: { user_id: string; label: string; type: string },
  ) => {
    try {
      const { data, error } = await supabase
        .from("semantic_nodes")
        .upsert(
          { user_id, label, type },
          { onConflict: "user_id,label,type", ignoreDuplicates: false },
        )
        .select()
        .single();

      if (error) {
        console.error("[upsert_semantic_node] Error:", error.message);
        throw new Error(error.message);
      }

      return JSON.stringify({
        message: "Nodo semántico creado o encontrado exitosamente",
        node: data,
      });
    } catch (error) {
      console.error("[upsert_semantic_node] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "upsert_semantic_node",
    description:
      "Crea un nuevo nodo semántico en el grafo o retorna el existente si ya existe uno con el mismo user_id, label y type. IMPORTANTE: Usa search_semantic_nodes primero para verificar si ya existe un nodo similar antes de crear uno nuevo. Los nodos representan conceptos abstractos: Empresas, Intereses, Emociones, Hobbies, etc.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario del grafo"),
      label: z.string().describe(
        "La etiqueta del nodo (ej: 'startup tecnológica', 'fotografía', 'ansioso')",
      ),
      type: z.string().describe(
        "El tipo de nodo (ej: 'Empresa', 'Interés', 'Emoción', 'Hobby')",
      ),
    }),
  },
);

export const create_semantic_edge = tool(
  async (
    { user_id, contact_id, node_id, relation_type, weight }: {
      user_id: string;
      contact_id: string;
      node_id: string;
      relation_type: string;
      weight?: number;
    },
  ) => {
    try {
      const { data, error } = await supabase
        .from("semantic_edges")
        .insert({
          user_id,
          source_id: contact_id,
          target_id: node_id,
          relation_type,
          weight: weight || 1.0,
        })
        .select()
        .single();

      if (error) {
        console.error("[create_semantic_edge] Error:", error.message);
        throw new Error(error.message);
      }

      await regenerateContactDetails(contact_id, user_id);

      return JSON.stringify({
        message:
          "Relación creada exitosamente y resumen del contacto actualizado",
        edge: data,
      });
    } catch (error) {
      console.error("[create_semantic_edge] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "create_semantic_edge",
    description:
      "Crea una relación (edge) entre un contacto y un nodo semántico. El source_id es el contact_id, el target_id es el node_id. El relation_type describe la relación (ej: 'trabaja_en', 'interesado_en', 'se_siente'). El weight (0-1) indica la intensidad de la relación. IMPORTANTE: Esta herramienta automáticamente regenera el resumen 'details' del contacto.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario"),
      contact_id: z.string().describe("El UUID del contacto (source)"),
      node_id: z.string().describe(
        "El UUID del nodo semántico (target) - obtenerlo de upsert_semantic_node",
      ),
      relation_type: z.string().describe(
        "Tipo de relación: 'trabaja_en', 'interesado_en', 'se_siente', 'practica', etc.",
      ),
      weight: z.number().optional().describe(
        "Peso/intensidad de la relación (0.0 a 1.0). Por defecto 1.0",
      ),
    }),
  },
);

export const update_edge_weight = tool(
  async (
    { edge_id, user_id, contact_id, weight }: {
      edge_id: string;
      user_id: string;
      contact_id: string;
      weight: number;
    },
  ) => {
    try {
      const { error } = await supabase
        .from("semantic_edges")
        .update({ weight })
        .eq("id", edge_id)
        .eq("user_id", user_id);

      if (error) {
        console.error("[update_edge_weight] Error:", error.message);
        throw new Error(error.message);
      }

      await regenerateContactDetails(contact_id, user_id);

      return `Peso de la relación actualizado a ${weight}. Resumen del contacto actualizado automáticamente.`;
    } catch (error) {
      console.error("[update_edge_weight] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "update_edge_weight",
    description:
      "Modifica la intensidad (weight) de una relación existente entre un contacto y un nodo semántico. Útil para reflejar cambios en la relevancia de un interés, emoción o relación. Esta herramienta automáticamente regenera el resumen 'details' del contacto.",
    schema: z.object({
      edge_id: z.string().describe(
        "El UUID de la arista a modificar (obtenerlo de get_contact_context_from_graph)",
      ),
      user_id: z.string().describe("El UUID del usuario propietario"),
      contact_id: z.string().describe(
        "El UUID del contacto para regenerar su resumen",
      ),
      weight: z.number().describe("Nuevo peso de la relación (0.0 a 1.0)"),
    }),
  },
);

export const delete_semantic_edge = tool(
  async (
    { edge_id, user_id, contact_id }: {
      edge_id: string;
      user_id: string;
      contact_id: string;
    },
  ) => {
    try {
      const { error } = await supabase
        .from("semantic_edges")
        .delete()
        .eq("id", edge_id)
        .eq("user_id", user_id);

      if (error) {
        console.error("[delete_semantic_edge] Error:", error.message);
        throw new Error(error.message);
      }

      await regenerateContactDetails(contact_id, user_id);

      return `Relación eliminada exitosamente. Resumen del contacto actualizado automáticamente.`;
    } catch (error) {
      console.error("[delete_semantic_edge] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "delete_semantic_edge",
    description:
      "Elimina una relación específica entre un contacto y un nodo semántico. Usa cuando un interés, emoción o relación ya no sea relevante. Esta herramienta automáticamente regenera el resumen 'details' del contacto.",
    schema: z.object({
      edge_id: z.string().describe(
        "El UUID de la arista a eliminar (obtenerlo de get_contact_context_from_graph)",
      ),
      user_id: z.string().describe("El UUID del usuario propietario"),
      contact_id: z.string().describe(
        "El UUID del contacto para regenerar su resumen",
      ),
    }),
  },
);

export const get_contact_connections = tool(
  async ({ user_id, node_id }: { user_id: string; node_id: string }) => {
    try {
      const { data, error } = await supabase
        .from("semantic_edges")
        .select(
          `
          id,
          relation_type,
          weight,
          contacts!semantic_edges_source_id_fkey (
            id,
            first_name,
            last_name
          )
        `,
        )
        .eq("target_id", node_id)
        .eq("user_id", user_id);

      if (error) {
        console.error("[get_contact_connections] Error:", error.message);
        throw new Error(error.message);
      }

      if (!data || data.length === 0) {
        return "No hay otros contactos conectados a este nodo semántico.";
      }

      return JSON.stringify(
        {
          message: `${data.length} contacto(s) conectado(s) a este nodo`,
          connections: data,
        },
        null,
        2,
      );
    } catch (error) {
      console.error("[get_contact_connections] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "get_contact_connections",
    description:
      "Encuentra qué contactos comparten un mismo nodo semántico (interconexiones). Útil para descubrir relaciones entre contactos: quiénes trabajan en la misma empresa, comparten intereses, etc. Es la base de la inteligencia relacional del sistema.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario del grafo"),
      node_id: z.string().describe(
        "El UUID del nodo semántico para buscar conexiones",
      ),
    }),
  },
);
