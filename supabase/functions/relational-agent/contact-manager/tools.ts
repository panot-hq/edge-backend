import { supabase } from "../lib/supabase.ts";
import { tool } from "langchain";
import { z } from "zod";
import { NodeType } from "../types.ts";

export const create_contact = tool(
  async (
    { user_id, first_name, last_name }: {
      user_id: string;
      first_name: string;
      last_name?: string;
    },
  ) => {
    try {
      const fullName = last_name
        ? `${first_name} ${last_name}`.trim()
        : first_name;

      const { data: node, error: nodeError } = await supabase
        .from("semantic_nodes")
        .insert({
          user_id,
          type: "CONTACT" as NodeType,
          label: fullName,
          concept_category: "Contacto",
          weight: 1,
        })
        .select("id")
        .single();

      if (nodeError) {
        console.error("[create_contact] Node Error:", nodeError.message);
        throw new Error(nodeError.message);
      }

      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          owner_id: user_id,
          node_id: node.id,
          first_name,
          last_name: last_name || "",
        })
        .select("id, first_name, last_name, node_id")
        .single();

      if (contactError) {
        await supabase.from("semantic_nodes").delete().eq("id", node.id);
        console.error("[create_contact] Contact Error:", contactError.message);
        throw new Error(contactError.message);
      }

      console.log(
        `[create_contact] Contacto creado: ${fullName} (contact_id: ${contact.id}, node_id: ${contact.node_id})`,
      );

      return JSON.stringify({
        success: true,
        contact_id: contact.id,
        node_id: contact.node_id,
        message: `Contacto ${fullName} creado`,
      });
    } catch (error) {
      console.error("[create_contact] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "create_contact",
    description: `Crea un nuevo contacto. 
    
    PROCESO INTERNO:
    1. Crea un nodo tipo CONTACT en el grafo (semantic_nodes)
    2. Crea el registro en la tabla contacts con referencia al nodo

    RETORNA: { contact_id, node_id } - ambos UUIDs son importantes:
    - contact_id: para operaciones de datos básicos
    - node_id: para operaciones de grafo (añadir info contextual)`,
    schema: z.object({
      user_id: z.string().describe(
        'El UUID del usuario propietario (formato: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")',
      ),
      first_name: z.string().describe(
        'El NOMBRE del contacto (texto legible como "María", "Angel"). NO es un UUID.',
      ),
      last_name: z.string().optional().describe(
        'El APELLIDO del contacto (texto legible como "García"). OPCIONAL.',
      ),
    }),
  },
);

export const get_contact_data = tool(
  async ({ contact_id }: { contact_id: string }) => {
    try {
      const { data, error } = await supabase
        .from("contacts")
        .select("*, node_id")
        .eq("id", contact_id)
        .maybeSingle();

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
      "Obtiene los detalles básicos de un contacto incluyendo su node_id (necesario para operaciones de grafo).",
    schema: z.object({
      contact_id: z.string().describe(
        'El UUID del contacto (formato: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx").',
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

      if (first_name || last_name) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("node_id, first_name, last_name")
          .eq("id", contact_id)
          .single();

        if (contact) {
          const fullName = `${contact.first_name} ${contact.last_name || ""}`
            .trim();
          await supabase
            .from("semantic_nodes")
            .update({ label: fullName })
            .eq("id", contact.node_id);
        }
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
      "Actualiza información básica del contacto: nombre, apellido, o canales de comunicación.",
    schema: z.object({
      contact_id: z.string().describe("El UUID del contacto a actualizar."),
      first_name: z.string().optional().describe("Nuevo nombre del contacto."),
      last_name: z.string().optional().describe("Nuevo apellido del contacto."),
      communication_channels: z
        .record(z.string(), z.string())
        .optional()
        .describe('Canales de comunicación: {"email": "...", "phone": "..."}'),
    }),
  },
);
