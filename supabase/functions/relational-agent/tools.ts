import { z } from "zod";
import { tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";
import { traceable } from "langsmith/traceable";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

type NodeType = "CONTACT" | "CONCEPT";

type SemanticNode = {
  id: string;
  label: string;
  type: NodeType;
  concept_category: string;
  weight: number;
};

type SimilarNode = SemanticNode & {
  similarity: number;
};

const SIMILARITY_THRESHOLD_EXACT = 0.90;
const SIMILARITY_THRESHOLD_RELATED = 0.45;

const generate_embedding = traceable(
  async (label: string, category: string): Promise<number[]> => {
    const text = `${label} | ${category}`;
    const vector = await embeddings.embedQuery(text);
    console.log(
      `[generate_embedding] Generado embedding para: "${text}" (${vector.length} dims)`,
    );
    return vector;
  },
  {
    name: "generateEmbedding",
    tags: ["helper", "embeddings"],
    metadata: { operation: "generate_embedding" },
  },
);

const find_similar_nodes = traceable(
  async (
    user_id: string,
    queryEmbedding: number[],
    options: {
      minSimilarity?: number;
      limit?: number;
      excludeNodeId?: string;
    } = {},
  ): Promise<SimilarNode[]> => {
    const {
      minSimilarity = SIMILARITY_THRESHOLD_RELATED,
      limit = 10,
      excludeNodeId,
    } = options;

    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    console.log(
      `[find_similar_nodes] Buscando nodos similares para user_id=${user_id}, umbral=${minSimilarity}`,
    );

    const query = supabase.rpc("match_semantic_nodes", {
      query_embedding: embeddingStr,
      match_threshold: minSimilarity,
      match_count: limit,
      p_user_id: user_id,
    });

    const { data, error } = await query;

    console.log(
      `[find_similar_nodes] RPC resultado: error=${
        error?.message || "null"
      }, data=${JSON.stringify(data)?.substring(0, 200)}`,
    );

    if (error) {
      console.log(
        `[find_similar_nodes] RPC error: ${error.message}, usando query directa`,
      );

      const { data: directData, error: directError } = await supabase
        .from("semantic_nodes")
        .select("id, label, type, concept_category, weight, embedding")
        .eq("user_id", user_id)
        .eq("type", "CONCEPT")
        .not("embedding", "is", null);

      if (directError) {
        console.error("[find_similar_nodes] Error:", directError.message);
        return [];
      }

      console.log(
        `[find_similar_nodes] Fallback: encontrados ${
          directData?.length || 0
        } nodos con embeddings`,
      );

      if (!directData || directData.length === 0) {
        console.log(
          "[find_similar_nodes] No hay nodos con embeddings para comparar",
        );
        return [];
      }

      const results: SimilarNode[] = [];
      for (const node of directData) {
        if (excludeNodeId && node.id === excludeNodeId) continue;
        if (!node.embedding) continue;

        let embeddingArray: number[];
        if (typeof node.embedding === "string") {
          try {
            embeddingArray = JSON.parse(node.embedding);
          } catch {
            continue;
          }
        } else {
          embeddingArray = node.embedding;
        }

        const similarity = cosineSimilarity(queryEmbedding, embeddingArray);
        console.log(
          `[find_similar_nodes] Comparando con "${node.label}": similitud=${
            (similarity * 100).toFixed(1)
          }%`,
        );
        if (similarity >= minSimilarity) {
          results.push({
            id: node.id,
            label: node.label,
            type: node.type as NodeType,
            concept_category: node.concept_category,
            weight: node.weight,
            similarity,
          });
        }
      }

      console.log(
        `[find_similar_nodes] Fallback: ${results.length} nodos superan umbral ${minSimilarity}`,
      );
      return results.sort((a, b) => b.similarity - a.similarity).slice(
        0,
        limit,
      );
    }

    if (!data || !Array.isArray(data)) {
      console.log("[find_similar_nodes] No hay nodos similares");
      return [];
    }

    const filtered = excludeNodeId
      ? data.filter((n: SimilarNode) => n.id !== excludeNodeId)
      : data;

    console.log(
      `[find_similar_nodes] Encontrados ${filtered.length} nodos similares (umbral: ${minSimilarity})`,
    );

    return filtered as SimilarNode[];
  },
  {
    name: "findSimilarNodes",
    tags: ["helper", "pgvector", "semantic"],
    metadata: { operation: "vector_search" },
  },
);

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const regenerate_contact_details = traceable(
  async (
    contact_id: string,
    node_id: string,
    mode: string,
    skip_details_regeneration: boolean,
  ): Promise<void> => {
    if (mode === "CONTACT_DETAILS_UPDATE" && !skip_details_regeneration) {
      console.log(
        `[regenerate_contact_details] BLOQUEADO: modo CONTACT_DETAILS_UPDATE detectado. No se actualizará details.`,
      );
      return;
    }

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
          target_id
        `)
        .eq("source_id", node_id);

      if (edgesError) throw new Error(edgesError.message);

      if (!edges || edges.length === 0) {
        await supabase
          .from("contacts")
          .update({ details: null })
          .eq("id", contact_id);
        return;
      }

      const targetIds = edges.map((e) => e.target_id);
      const { data: targetNodes, error: nodesError } = await supabase
        .from("semantic_nodes")
        .select("id, label, concept_category")
        .in("id", targetIds);

      if (nodesError) throw new Error(nodesError.message);

      const nodesMap = new Map(targetNodes?.map((n) => [n.id, n]) || []);

      const graphContext = edges
        .map((edge) => {
          const node = nodesMap.get(edge.target_id);
          if (!node) return null;
          return `- ${edge.relation_type}: ${node.label} (${node.concept_category})`;
        })
        .filter(Boolean)
        .join("\n");

      if (!graphContext) {
        await supabase
          .from("contacts")
          .update({ details: null })
          .eq("id", contact_id);
        return;
      }

      const prompt =
        `Genera un resumen breve (2-3 frases) sobre este contacto basándote únicamente en los datos del grafo.

Contacto: ${contact.first_name} ${contact.last_name}

Grafo de contexto:
${graphContext}

Instrucciones:
- Menciona solo los hechos presentes en el grafo (hobbies, intereses, emociones, situaciones)
- NO hagas inferencias, conclusiones ni juicios de valor
- NO uses frases como "lo convierte en", "refleja que", "demuestra que"
- Sé directo y factual
- Usa un tono neutro y descriptivo
- NUNCA incluyas el nombre ni el apellido del contacto en el resumen

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

export const get_contact_context_from_graph = tool(
  async ({ node_id }: { node_id: string }) => {
    try {
      const { data: edges, error: edgesError } = await supabase
        .from("semantic_edges")
        .select("id, relation_type, target_id, created_at")
        .eq("source_id", node_id);

      if (edgesError) {
        console.error(
          "[get_contact_context_from_graph] Edges Error:",
          edgesError.message,
        );
        throw new Error(edgesError.message);
      }

      if (!edges || edges.length === 0) {
        return `No hay información contextual registrada en el grafo para este contacto.`;
      }

      const targetIds = edges.map((e) => e.target_id);
      const { data: targetNodes, error: nodesError } = await supabase
        .from("semantic_nodes")
        .select("id, label, type, concept_category, weight")
        .in("id", targetIds);

      if (nodesError) {
        console.error(
          "[get_contact_context_from_graph] Nodes Error:",
          nodesError.message,
        );
        throw new Error(nodesError.message);
      }

      const nodesMap = new Map(targetNodes?.map((n) => [n.id, n]) || []);

      const result = edges.map((edge) => {
        const node = nodesMap.get(edge.target_id);
        return {
          edge_id: edge.id,
          relation_type: edge.relation_type,
          node: node
            ? {
              id: node.id,
              label: node.label,
              type: node.type,
              category: node.concept_category,
              weight: node.weight,
              is_shared: node.weight > 1,
            }
            : null,
        };
      });

      return JSON.stringify(result, null, 2);
    } catch (error) {
      console.error("[get_contact_context_from_graph] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "get_contact_context_from_graph",
    description:
      "Obtiene el grafo de conocimiento completo del contacto: todos sus nodos (intereses, hobbies, emociones, empresas) y aristas. Indica si los nodos son compartidos con otros contactos (is_shared).",
    schema: z.object({
      node_id: z.string().describe(
        "El node_id del contacto (UUID del nodo CONTACT en semantic_nodes).",
      ),
    }),
  },
);

export const search_semantic_nodes = tool(
  async (
    { user_id, concept_category, label_search }: {
      user_id: string;
      concept_category?: string;
      label_search?: string;
    },
  ) => {
    try {
      let query = supabase
        .from("semantic_nodes")
        .select("id, label, type, concept_category, weight, created_at")
        .eq("user_id", user_id)
        .eq("type", "CONCEPT");

      if (concept_category) {
        query = query.eq("concept_category", concept_category);
      }
      if (label_search) {
        query = query.ilike("label", `%${label_search}%`);
      }

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
      "Busca nodos CONCEPT existentes en el grafo. Útil para descubrir interconexiones.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario del grafo"),
      concept_category: z
        .string()
        .optional()
        .describe(
          'Filtrar por categoría: "Empresa", "Interés", "Emoción", "Hobby", etc.',
        ),
      label_search: z
        .string()
        .optional()
        .describe("Búsqueda parcial en la etiqueta del nodo"),
    }),
  },
);

export const get_contact_connections_from_node = tool(
  async ({ user_id, node_id }: { user_id: string; node_id: string }) => {
    try {
      const { data: edges, error: edgesError } = await supabase
        .from("semantic_edges")
        .select("id, source_id, relation_type")
        .eq("target_id", node_id)
        .eq("user_id", user_id);

      if (edgesError) {
        console.error(
          "[get_contact_connections_from_node] Edges Error:",
          edgesError.message,
        );
        throw new Error(edgesError.message);
      }

      if (!edges || edges.length === 0) {
        return "No hay contactos conectados a este nodo.";
      }

      const sourceIds = edges.map((e) => e.source_id);
      const { data: contacts, error: contactsError } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, node_id")
        .in("node_id", sourceIds);

      if (contactsError) {
        console.error(
          "[get_contact_connections_from_node] Contacts Error:",
          contactsError.message,
        );
        throw new Error(contactsError.message);
      }

      const contactsMap = new Map(contacts?.map((c) => [c.node_id, c]) || []);

      const connections = edges.map((edge) => {
        const contact = contactsMap.get(edge.source_id);
        return {
          edge_id: edge.id,
          relation_type: edge.relation_type,
          contact: contact
            ? {
              id: contact.id,
              name: `${contact.first_name} ${contact.last_name || ""}`.trim(),
              node_id: contact.node_id,
            }
            : null,
        };
      });

      return JSON.stringify(
        {
          message: `${connections.length} contacto(s) conectado(s) a este nodo`,
          connections: connections.filter((c) => c.contact !== null),
        },
        null,
        2,
      );
    } catch (error) {
      console.error("[get_contact_connections_from_node] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "get_contact_connections",
    description:
      "Descubre qué contactos comparten un mismo nodo - el CORAZÓN de las interconexiones de PANOT.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario del grafo"),
      node_id: z.string().describe(
        "El UUID del nodo CONCEPT para buscar contactos conectados",
      ),
    }),
  },
);

export const find_shared_connections_for_contact = tool(
  async ({ user_id, node_id }: { user_id: string; node_id: string }) => {
    try {
      const { data: contactEdges, error: edgesError } = await supabase
        .from("semantic_edges")
        .select("target_id, relation_type")
        .eq("source_id", node_id)
        .eq("user_id", user_id);

      if (edgesError) {
        console.error(
          "[find_shared_connections_for_contact] Edges Error:",
          edgesError.message,
        );
        throw new Error(edgesError.message);
      }

      if (!contactEdges || contactEdges.length === 0) {
        return "El contacto no tiene nodos asociados.";
      }

      const targetIds = contactEdges.map((e) => e.target_id);
      const { data: targetNodes, error: nodesError } = await supabase
        .from("semantic_nodes")
        .select("id, label, concept_category, weight")
        .in("id", targetIds)
        .gt("weight", 1);

      if (nodesError) {
        console.error(
          "[find_shared_connections_for_contact] Nodes Error:",
          nodesError.message,
        );
        throw new Error(nodesError.message);
      }

      if (!targetNodes || targetNodes.length === 0) {
        return "Este contacto no comparte nodos con otros contactos.";
      }

      const sharedConnections = await Promise.all(
        targetNodes.map(async (targetNode) => {
          const { data: otherEdges } = await supabase
            .from("semantic_edges")
            .select("source_id, relation_type")
            .eq("target_id", targetNode.id)
            .eq("user_id", user_id)
            .neq("source_id", node_id);

          if (!otherEdges || otherEdges.length === 0) return null;

          const otherSourceIds = otherEdges.map((e) => e.source_id);
          const { data: otherContacts } = await supabase
            .from("contacts")
            .select("id, first_name, last_name, node_id")
            .in("node_id", otherSourceIds);

          if (!otherContacts || otherContacts.length === 0) return null;

          return {
            shared_node: {
              id: targetNode.id,
              label: targetNode.label,
              category: targetNode.concept_category,
              total_connections: targetNode.weight,
            },
            other_contacts: otherContacts.map((c) => ({
              id: c.id,
              name: `${c.first_name} ${c.last_name || ""}`.trim(),
            })),
          };
        }),
      );

      const validConnections = sharedConnections.filter(
        (c) => c !== null,
      );

      if (validConnections.length === 0) {
        return "No se encontraron otros contactos que compartan nodos.";
      }

      return JSON.stringify(
        {
          message:
            `Se encontraron ${validConnections.length} nodo(s) compartido(s)`,
          shared_connections: validConnections,
        },
        null,
        2,
      );
    } catch (error) {
      console.error("[find_shared_connections_for_contact] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "find_shared_connections_for_contact",
    description:
      "Descubre TODOS los contactos que comparten contexto con un contacto específico. EL VALOR CLAVE DE PANOT.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario del grafo"),
      node_id: z.string().describe(
        "El node_id del contacto (UUID del nodo CONTACT)",
      ),
    }),
  },
);

export const upsert_semantic_node = tool(
  async (
    { user_id, label, concept_category }: {
      user_id: string;
      label: string;
      concept_category: string;
    },
  ) => {
    try {
      const { data: existingNode, error: searchError } = await supabase
        .from("semantic_nodes")
        .select("*")
        .eq("user_id", user_id)
        .eq("type", "CONCEPT")
        .ilike("label", label)
        .maybeSingle();

      if (searchError) {
        console.error(
          "[upsert_semantic_node] Search Error:",
          searchError.message,
        );
        throw new Error(searchError.message);
      }

      if (existingNode) {
        const { data: updatedNode, error: updateError } = await supabase
          .from("semantic_nodes")
          .update({ weight: existingNode.weight + 1 })
          .eq("id", existingNode.id)
          .select()
          .single();

        if (updateError) {
          console.error(
            "[upsert_semantic_node] Update Error:",
            updateError.message,
          );
          throw new Error(updateError.message);
        }

        return JSON.stringify({
          message: `Nodo reutilizado. Weight: ${updatedNode.weight}`,
          node: updatedNode,
          reused: true,
        });
      } else {
        const { data: newNode, error: insertError } = await supabase
          .from("semantic_nodes")
          .insert({
            user_id,
            type: "CONCEPT" as NodeType,
            label,
            concept_category,
            weight: 1,
          })
          .select()
          .single();

        if (insertError) {
          console.error(
            "[upsert_semantic_node] Insert Error:",
            insertError.message,
          );
          throw new Error(insertError.message);
        }

        return JSON.stringify({
          message: "Nodo creado exitosamente",
          node: newNode,
          reused: false,
        });
      }
    } catch (error) {
      console.error("[upsert_semantic_node] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "upsert_semantic_node",
    description:
      "Crea un nuevo nodo CONCEPT o retorna el existente si ya existe.",
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario del grafo"),
      label: z.string().describe('Etiqueta del nodo (ej: "pádel", "Google")'),
      concept_category: z.string().describe(
        'Categoría del concepto: "Hobby", "Empresa", "Interés", "Emoción", etc.',
      ),
    }),
  },
);

export const create_semantic_edge = tool(
  async (
    {
      user_id,
      source_node_id,
      target_node_id,
      relation_type,
    }: {
      user_id: string;
      source_node_id: string;
      target_node_id: string;
      relation_type: string;
    },
  ) => {
    try {
      const { data: existingEdge } = await supabase
        .from("semantic_edges")
        .select("id")
        .eq("source_id", source_node_id)
        .eq("target_id", target_node_id)
        .eq("user_id", user_id)
        .maybeSingle();

      if (existingEdge) {
        return JSON.stringify({
          message: "La arista ya existe",
          edge_id: existingEdge.id,
          already_existed: true,
        });
      }

      const { data, error } = await supabase
        .from("semantic_edges")
        .insert({
          user_id,
          source_id: source_node_id,
          target_id: target_node_id,
          relation_type,
        })
        .select()
        .single();

      if (error) {
        console.error("[create_semantic_edge] Error:", error.message);
        throw new Error(error.message);
      }

      return JSON.stringify({
        message: "Arista creada exitosamente",
        edge: data,
      });
    } catch (error) {
      console.error("[create_semantic_edge] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "create_semantic_edge",
    description: `Crea una arista entre dos nodos. Puede ser:
- CONTACT → CONCEPT (contacto tiene un interés/hobby/etc)
- CONCEPT → CONCEPT (relación entre conceptos, ej: "Marco Aurelio" ES_FIGURA_DE "estoicismo")`,
    schema: z.object({
      user_id: z.string().describe("El UUID del usuario propietario"),
      source_node_id: z.string().describe(
        "UUID del nodo origen (puede ser CONTACT o CONCEPT)",
      ),
      target_node_id: z.string().describe(
        "UUID del nodo destino (normalmente CONCEPT)",
      ),
      relation_type: z.string().describe(
        'Tipo de relación: "PRACTICA", "TRABAJA_EN", "ES_FIGURA_DE", "ES_PARTE_DE", etc.',
      ),
    }),
  },
);

export const update_edge_weight = tool(
  async (
    {
      edge_id,
      user_id,
      source_node_id,
      weight,
      skip_details_regeneration,
    }: {
      edge_id: string;
      user_id: string;
      source_node_id: string;
      weight: number;
      skip_details_regeneration: boolean;
    },
  ) => {
    try {
      const { data, error } = await supabase
        .from("semantic_edges")
        .update({ weight })
        .eq("id", edge_id)
        .eq("user_id", user_id)
        .eq("source_id", source_node_id)
        .select()
        .maybeSingle();

      if (error) {
        console.error("[update_edge_weight] Error:", error.message);
        throw new Error(error.message);
      }

      if (!data) {
        throw new Error("Edge not found or does not belong to the source node");
      }

      if (!skip_details_regeneration) {
        const { data: sourceNode } = await supabase
          .from("semantic_nodes")
          .select("id, type")
          .eq("id", source_node_id)
          .single();

        if (sourceNode?.type === "CONTACT") {
          const { data: contact } = await supabase
            .from("contacts")
            .select("id")
            .eq("node_id", source_node_id)
            .single();

          if (contact && !skip_details_regeneration) {
            await regenerate_contact_details(
              contact.id,
              source_node_id,
              "",
              false,
            );
          }
        }
      }

      return `Peso de la relación actualizado a ${weight}.`;
    } catch (error) {
      console.error("[update_edge_weight] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "update_edge_weight",
    description: "Modifica la intensidad de una relación existente.",
    schema: z.object({
      edge_id: z.string().describe("El UUID de la arista a modificar"),
      user_id: z.string().describe("El UUID del usuario propietario"),
      source_node_id: z.string().describe(
        "El UUID del nodo origen de la arista (para validación)",
      ),
      weight: z.number().describe("Nuevo peso de la relación (0.0 a 1.0)"),
      skip_details_regeneration: z
        .boolean()
        .describe(
          "Si true, no regenera details. Usar SIEMPRE que se esté en modo CONTACT_DETAILS_UPDATE.",
        ),
    }),
  },
);

export const delete_semantic_edge = tool(
  async (
    {
      edge_id,
      user_id,
      source_node_id,
      skip_details_regeneration,
    }: {
      edge_id: string;
      user_id: string;
      source_node_id: string;
      skip_details_regeneration: boolean;
    },
  ) => {
    try {
      const { data: deletedEdge, error: deleteEdgeError } = await supabase
        .from("semantic_edges")
        .delete()
        .eq("id", edge_id)
        .eq("user_id", user_id)
        .eq("source_id", source_node_id)
        .select("target_id")
        .maybeSingle();

      if (deleteEdgeError) {
        console.error(
          "[delete_semantic_edge] Delete Edge Error:",
          deleteEdgeError.message,
        );
        throw new Error(deleteEdgeError.message);
      }

      if (!deletedEdge) {
        throw new Error("Edge not found or does not belong to the source node");
      }

      const targetNodeId = deletedEdge.target_id;

      const { data: node, error: getNodeError } = await supabase
        .from("semantic_nodes")
        .select("weight, type")
        .eq("id", targetNodeId)
        .eq("user_id", user_id)
        .maybeSingle();

      if (getNodeError) {
        console.error(
          "[delete_semantic_edge] Get Node Error:",
          getNodeError.message,
        );
        throw new Error(getNodeError.message);
      }

      let nodeStatus = "Nodo no encontrado";

      if (node && node.type === "CONCEPT") {
        const newWeight = node.weight - 1;

        if (newWeight <= 0) {
          await supabase
            .from("semantic_nodes")
            .delete()
            .eq("id", targetNodeId)
            .eq("user_id", user_id);
          nodeStatus = "Nodo eliminado (ya no tenía conexiones)";
        } else {
          await supabase
            .from("semantic_nodes")
            .update({ weight: newWeight })
            .eq("id", targetNodeId)
            .eq("user_id", user_id);
          nodeStatus = `Nodo todavía en uso (weight: ${newWeight})`;
        }
      }

      if (!skip_details_regeneration) {
        const { data: sourceNode } = await supabase
          .from("semantic_nodes")
          .select("id, type")
          .eq("id", source_node_id)
          .single();

        if (sourceNode?.type === "CONTACT") {
          const { data: contact } = await supabase
            .from("contacts")
            .select("id")
            .eq("node_id", source_node_id)
            .single();

          if (contact && !skip_details_regeneration) {
            await regenerate_contact_details(
              contact.id,
              source_node_id,
              "",
              false,
            );
          }
        }
      }

      return `Arista eliminada. ${nodeStatus}.`;
    } catch (error) {
      console.error("[delete_semantic_edge] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "delete_semantic_edge",
    description:
      "Elimina una arista. SOLO elimina aristas del source_node_id especificado, nunca afecta otros nodos.",
    schema: z.object({
      edge_id: z.string().describe("El UUID de la arista a eliminar"),
      user_id: z.string().describe("El UUID del usuario propietario"),
      source_node_id: z.string().describe(
        "El UUID del nodo origen de la arista (para validación)",
      ),
      skip_details_regeneration: z
        .boolean()
        .describe(
          "Si true, no regenera details. Usar SIEMPRE que se esté en modo CONTACT_DETAILS_UPDATE.",
        ),
    }),
  },
);

export const add_info_to_contact_graph = tool(
  async ({
    user_id,
    node_id,
    contact_id,
    label,
    concept_category,
    relation_type,
    skip_details_regeneration,
  }: {
    user_id: string;
    node_id: string;
    contact_id: string;
    label: string;
    concept_category: string;
    relation_type: string;
    skip_details_regeneration: boolean;
  }) => {
    try {
      const { data: exactMatch, error: exactSearchError } = await supabase
        .from("semantic_nodes")
        .select("id, weight, label, type, concept_category, embedding")
        .eq("user_id", user_id)
        .eq("type", "CONCEPT")
        .ilike("label", label)
        .maybeSingle();

      if (exactSearchError) {
        console.error(
          "[add_info_to_contact_graph] Exact Search Error:",
          exactSearchError.message,
        );
        throw new Error(exactSearchError.message);
      }

      let targetNodeId: string;
      let nodeReused = false;
      let nodeLabel = label;
      let nodeCategory = concept_category;
      let semanticMatchInfo = "";
      let relatedNodes: SimilarNode[] = [];

      if (exactMatch) {
        targetNodeId = exactMatch.id;
        nodeReused = true;
        nodeLabel = exactMatch.label;
        nodeCategory = exactMatch.concept_category;

        console.log(
          `[add_info_to_contact_graph] Nodo encontrado (exacto): ${nodeLabel}`,
        );

        const queryEmbedding = await generate_embedding(
          label,
          concept_category,
        );
        const similarNodes = await find_similar_nodes(user_id, queryEmbedding, {
          minSimilarity: SIMILARITY_THRESHOLD_RELATED,
          limit: 5,
        });

        relatedNodes = similarNodes.filter(
          (n) =>
            n.id !== targetNodeId &&
            n.similarity >= SIMILARITY_THRESHOLD_RELATED &&
            n.similarity < SIMILARITY_THRESHOLD_EXACT,
        );

        if (relatedNodes.length > 0) {
          const { data: sameContactNodes } = await supabase
            .from("semantic_edges")
            .select("target_id")
            .eq("source_id", node_id)
            .eq("user_id", user_id)
            .in("target_id", relatedNodes.map((n) => n.id));

          const sameContactNodeIds = new Set(
            sameContactNodes?.map((e) => e.target_id) || [],
          );

          relatedNodes = relatedNodes.filter(
            (n) => !sameContactNodeIds.has(n.id),
          );

          console.log(
            `[add_info_to_contact_graph] (exactMatch) Nodos relacionados: ${relatedNodes.length} (excluidos ${sameContactNodeIds.size} del mismo contacto)`,
            relatedNodes.map((r) =>
              `${r.label}(${(r.similarity * 100).toFixed(0)}%)`
            ),
          );
        }

        if (!exactMatch.embedding) {
          await supabase
            .from("semantic_nodes")
            .update({ embedding: queryEmbedding })
            .eq("id", targetNodeId);
          console.log(
            `[add_info_to_contact_graph] Embedding actualizado para nodo existente: ${nodeLabel}`,
          );
        }
      } else {
        const queryEmbedding = await generate_embedding(
          label,
          concept_category,
        );

        const similarNodes = await find_similar_nodes(user_id, queryEmbedding, {
          minSimilarity: SIMILARITY_THRESHOLD_RELATED,
          limit: 5,
        });

        const highMatch = similarNodes.find(
          (n) => n.similarity >= SIMILARITY_THRESHOLD_EXACT,
        );

        if (highMatch) {
          targetNodeId = highMatch.id;
          nodeReused = true;
          nodeLabel = highMatch.label;
          nodeCategory = highMatch.concept_category;
          semanticMatchInfo = ` (match semántico ${
            (highMatch.similarity * 100).toFixed(0)
          }%: "${label}" → "${highMatch.label}")`;

          console.log(
            `[add_info_to_contact_graph] Nodo encontrado (embedding ${
              (highMatch.similarity * 100).toFixed(0)
            }%): "${label}" → "${highMatch.label}"`,
          );
        } else {
          const { data: newNode, error: insertError } = await supabase
            .from("semantic_nodes")
            .insert({
              user_id,
              type: "CONCEPT" as NodeType,
              label,
              concept_category,
              weight: 1,
              embedding: queryEmbedding,
            })
            .select("id")
            .single();

          if (insertError) {
            if (insertError.code === "23505") {
              console.log(
                `[add_info_to_contact_graph] Nodo "${label}" ya existe, buscando...`,
              );
              const { data: existingNode } = await supabase
                .from("semantic_nodes")
                .select("id, weight")
                .eq("user_id", user_id)
                .eq("type", "CONCEPT")
                .ilike("label", label)
                .single();

              if (existingNode) {
                targetNodeId = existingNode.id;
                nodeReused = true;
                console.log(
                  `[add_info_to_contact_graph] Nodo encontrado (duplicado): ${label}`,
                );
              } else {
                throw new Error(insertError.message);
              }
            } else {
              console.error(
                "[add_info_to_contact_graph] Insert Node Error:",
                insertError.message,
              );
              throw new Error(insertError.message);
            }
          } else {
            targetNodeId = newNode.id;
            console.log(
              `[add_info_to_contact_graph] Nuevo nodo creado con embedding: ${label}`,
            );
          }
        }

        relatedNodes = similarNodes.filter(
          (n) =>
            n.id !== targetNodeId &&
            n.similarity >= SIMILARITY_THRESHOLD_RELATED &&
            n.similarity < SIMILARITY_THRESHOLD_EXACT,
        );

        if (relatedNodes.length > 0) {
          const { data: sameContactNodes } = await supabase
            .from("semantic_edges")
            .select("target_id")
            .eq("source_id", node_id)
            .eq("user_id", user_id)
            .in("target_id", relatedNodes.map((n) => n.id));

          const sameContactNodeIds = new Set(
            sameContactNodes?.map((e) => e.target_id) || [],
          );

          relatedNodes = relatedNodes.filter(
            (n) => !sameContactNodeIds.has(n.id),
          );

          console.log(
            `[add_info_to_contact_graph] Nodos relacionados encontrados: ${relatedNodes.length} (excluidos ${sameContactNodeIds.size} del mismo contacto)`,
            relatedNodes.map((r) =>
              `${r.label}(${(r.similarity * 100).toFixed(0)}%)`
            ),
          );
        }
      }

      const { data: existingEdge, error: edgeCheckError } = await supabase
        .from("semantic_edges")
        .select("id")
        .eq("source_id", node_id)
        .eq("target_id", targetNodeId)
        .eq("user_id", user_id)
        .maybeSingle();

      if (edgeCheckError) {
        console.error(
          "[add_info_to_contact_graph] Edge Check Error:",
          edgeCheckError.message,
        );
        throw new Error(edgeCheckError.message);
      }

      if (existingEdge) {
        return JSON.stringify({
          status: "already_connected",
          message:
            `El contacto ya está conectado a "${nodeLabel}" (${nodeCategory})`,
          target_node_id: targetNodeId,
          edge_id: existingEdge.id,
          reused_node: nodeReused,
        });
      }

      if (nodeReused) {
        const { data: currentNode } = await supabase
          .from("semantic_nodes")
          .select("weight")
          .eq("id", targetNodeId)
          .single();

        if (currentNode) {
          await supabase
            .from("semantic_nodes")
            .update({ weight: currentNode.weight + 1 })
            .eq("id", targetNodeId);
          console.log(
            `[add_info_to_contact_graph] Peso incrementado para nodo reutilizado: ${nodeLabel} (weight: ${
              currentNode.weight + 1
            })`,
          );
        }
      }

      const { data: newEdge, error: edgeError } = await supabase
        .from("semantic_edges")
        .insert({
          user_id,
          source_id: node_id,
          target_id: targetNodeId,
          relation_type,
        })
        .select("id")
        .single();

      if (edgeError) {
        console.error(
          "[add_info_to_contact_graph] Create Edge Error:",
          edgeError.message,
        );
        throw new Error(edgeError.message);
      }

      const conceptRelationsCreated: string[] = [];
      if (relatedNodes.length > 0) {
        for (const relatedNode of relatedNodes) {
          const { data: existingRelation } = await supabase
            .from("semantic_edges")
            .select("id")
            .eq("source_id", targetNodeId)
            .eq("target_id", relatedNode.id)
            .eq("user_id", user_id)
            .maybeSingle();

          if (!existingRelation) {
            await supabase.from("semantic_edges").insert({
              user_id,
              source_id: targetNodeId,
              target_id: relatedNode.id,
              relation_type: "RELACIONADO_CON",
            });

            conceptRelationsCreated.push(
              `"${label}" ↔ "${relatedNode.label}" (${
                (relatedNode.similarity * 100).toFixed(0)
              }%)`,
            );

            console.log(
              `[add_info_to_contact_graph] Relación CONCEPT→CONCEPT creada: "${label}" → "${relatedNode.label}" (${
                (relatedNode.similarity * 100).toFixed(0)
              }%)`,
            );
          }
        }
      }

      if (!skip_details_regeneration) {
        await regenerate_contact_details(contact_id, node_id, "", false);
      }

      const interconexionMsg = nodeReused
        ? ` INTERCONEXIÓN: Este nodo es compartido con otros contactos.${semanticMatchInfo}`
        : "";

      const conceptRelationsMsg = conceptRelationsCreated.length > 0
        ? ` RELACIONES SEMÁNTICAS CREADAS: ${
          conceptRelationsCreated.join(", ")
        }`
        : "";

      return JSON.stringify({
        status: "connected",
        message:
          `Contacto conectado a "${nodeLabel}" (${nodeCategory}) con relación ${relation_type}.${interconexionMsg}${conceptRelationsMsg}`,
        target_node_id: targetNodeId,
        edge_id: newEdge.id,
        reused_node: nodeReused,
        semantic_match: semanticMatchInfo !== "",
        concept_relations_created: conceptRelationsCreated.length,
        details_updated: !skip_details_regeneration,
      });
    } catch (error) {
      console.error("[add_info_to_contact_graph] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "add_info_to_contact_graph",
    description:
      `HERRAMIENTA PRINCIPAL para añadir información contextual a un contacto.

EN UNA SOLA LLAMADA: busca nodo → crea si no existe → crea arista.

MATCHING INTELIGENTE:
- Para CONCEPTOS (Hobby, Interés, Emoción): Busca matches semánticos
- Para INSTANCIAS (Universidad, Empresa, Persona): NO hace match (UPM ≠ Complutense)

Usa esta herramienta en lugar de search + upsert + create_edge.`,
    schema: z.object({
      user_id: z.string().describe("UUID del usuario propietario"),
      node_id: z.string().describe(
        "UUID del nodo CONTACT (el node_id del contacto, NO el contact_id)",
      ),
      contact_id: z.string().describe(
        "UUID del contacto (para regenerar details)",
      ),
      label: z.string().describe(
        'Etiqueta del concepto (ej: "pádel", "Google")',
      ),
      concept_category: z.string().describe(
        'Categoría: "Hobby", "Empresa", "Interés", "Emoción", "Universidad", etc.',
      ),
      relation_type: z.string().describe(
        'Tipo de relación: "PRACTICA", "TRABAJA_EN", "INTERESADO_EN", etc.',
      ),
      skip_details_regeneration: z
        .boolean()
        .describe(
          "Si true, no regenera details. Usar SIEMPRE que se esté en modo CONTACT_DETAILS_UPDATE.",
        ),
    }),
  },
);

export const batch_add_info_to_graph = tool(
  async ({
    user_id,
    node_id,
    contact_id,
    items,
    skip_details_regeneration,
  }: {
    user_id: string;
    node_id: string;
    contact_id: string;
    items: Array<{
      label: string;
      concept_category: string;
      relation_type: string;
    }>;
    skip_details_regeneration: boolean;
  }) => {
    try {
      const results: Array<{
        label: string;
        status: string;
        target_node_id?: string;
        reused?: boolean;
        semantic_match?: boolean;
        similarity?: number;
        matched_to?: string;
        concept_relations?: string[];
      }> = [];

      for (const item of items) {
        const { data: exactMatch } = await supabase
          .from("semantic_nodes")
          .select("id, weight, label, concept_category, embedding")
          .eq("user_id", user_id)
          .eq("type", "CONCEPT")
          .ilike("label", item.label)
          .maybeSingle();

        let targetNodeId: string;
        let nodeReused = false;
        let semanticMatch = false;
        let similarity: number | undefined;
        let matchedTo: string | undefined;
        const conceptRelationsCreated: string[] = [];

        const queryEmbedding = await generate_embedding(
          item.label,
          item.concept_category,
        );
        const similarNodes = await find_similar_nodes(
          user_id,
          queryEmbedding,
          {
            minSimilarity: SIMILARITY_THRESHOLD_RELATED,
            limit: 5,
          },
        );

        if (exactMatch) {
          targetNodeId = exactMatch.id;
          nodeReused = true;

          if (!exactMatch.embedding) {
            await supabase
              .from("semantic_nodes")
              .update({ embedding: queryEmbedding })
              .eq("id", targetNodeId);
          }
        } else {
          const highMatch = similarNodes.find(
            (n) => n.similarity >= SIMILARITY_THRESHOLD_EXACT,
          );

          if (highMatch) {
            targetNodeId = highMatch.id;
            nodeReused = true;
            semanticMatch = true;
            similarity = highMatch.similarity;
            matchedTo = highMatch.label;
            console.log(
              `[batch_add_info_to_graph] Match semántico (${
                (highMatch.similarity * 100).toFixed(0)
              }%): "${item.label}" → "${highMatch.label}"`,
            );
          } else {
            const { data: newNode, error: insertError } = await supabase
              .from("semantic_nodes")
              .insert({
                user_id,
                type: "CONCEPT" as NodeType,
                label: item.label,
                concept_category: item.concept_category,
                weight: 1,
                embedding: queryEmbedding,
              })
              .select("id")
              .single();

            if (insertError) {
              if (insertError.code === "23505") {
                console.log(
                  `[batch_add_info_to_graph] Nodo "${item.label}" ya existe, buscando...`,
                );
                const { data: existingNode } = await supabase
                  .from("semantic_nodes")
                  .select("id, weight")
                  .eq("user_id", user_id)
                  .eq("type", "CONCEPT")
                  .ilike("label", item.label)
                  .single();

                if (existingNode) {
                  targetNodeId = existingNode.id;
                  nodeReused = true;
                } else {
                  throw new Error(insertError.message);
                }
              } else {
                console.error(
                  `[batch_add_info_to_graph] Insert error for "${item.label}":`,
                  insertError.message,
                );
                throw new Error(insertError.message);
              }
            } else {
              targetNodeId = newNode.id;
            }
          }
        }

        let relatedNodes = similarNodes.filter(
          (n) =>
            n.id !== targetNodeId &&
            n.similarity >= SIMILARITY_THRESHOLD_RELATED &&
            n.similarity < SIMILARITY_THRESHOLD_EXACT,
        );
        if (relatedNodes.length > 0) {
          const { data: sameContactNodes } = await supabase
            .from("semantic_edges")
            .select("target_id")
            .eq("source_id", node_id)
            .eq("user_id", user_id)
            .in("target_id", relatedNodes.map((n) => n.id));

          const sameContactNodeIds = new Set(
            sameContactNodes?.map((e) => e.target_id) || [],
          );

          relatedNodes = relatedNodes.filter(
            (n) => !sameContactNodeIds.has(n.id),
          );

          console.log(
            `[batch_add_info_to_graph] Nodos relacionados para "${item.label}": ${relatedNodes.length} (excluidos ${sameContactNodeIds.size} del mismo contacto)`,
          );
        }

        for (const relatedNode of relatedNodes) {
          const { data: existingRelation } = await supabase
            .from("semantic_edges")
            .select("id")
            .eq("source_id", targetNodeId)
            .eq("target_id", relatedNode.id)
            .eq("user_id", user_id)
            .maybeSingle();

          if (!existingRelation) {
            await supabase.from("semantic_edges").insert({
              user_id,
              source_id: targetNodeId,
              target_id: relatedNode.id,
              relation_type: "RELACIONADO_CON",
            });
            conceptRelationsCreated.push(
              `${item.label} ↔ ${relatedNode.label}`,
            );
            console.log(
              `[batch_add_info_to_graph] Relación CONCEPT→CONCEPT: ${item.label} ↔ ${relatedNode.label}`,
            );
          }
        }

        const { data: existingEdge } = await supabase
          .from("semantic_edges")
          .select("id")
          .eq("source_id", node_id)
          .eq("target_id", targetNodeId)
          .eq("user_id", user_id)
          .maybeSingle();

        if (existingEdge) {
          results.push({
            label: item.label,
            status: "already_connected",
            target_node_id: targetNodeId,
            reused: nodeReused,
            semantic_match: semanticMatch,
            similarity,
            matched_to: matchedTo,
          });
          continue;
        }

        if (nodeReused) {
          const { data: currentNode } = await supabase
            .from("semantic_nodes")
            .select("weight")
            .eq("id", targetNodeId)
            .single();

          if (currentNode) {
            await supabase
              .from("semantic_nodes")
              .update({ weight: currentNode.weight + 1 })
              .eq("id", targetNodeId);
            console.log(
              `[batch_add_info_to_graph] Peso incrementado para nodo reutilizado: ${item.label} (weight: ${
                currentNode.weight + 1
              })`,
            );
          }
        }

        await supabase.from("semantic_edges").insert({
          user_id,
          source_id: node_id,
          target_id: targetNodeId,
          relation_type: item.relation_type,
        });

        results.push({
          label: item.label,
          status: "connected",
          target_node_id: targetNodeId,
          reused: nodeReused,
          semantic_match: semanticMatch,
          similarity,
          matched_to: matchedTo,
          concept_relations: conceptRelationsCreated.length > 0
            ? conceptRelationsCreated
            : undefined,
        });
      }

      if (!skip_details_regeneration) {
        await regenerate_contact_details(contact_id, node_id, "", false);
      }

      const connected = results.filter((r) => r.status === "connected").length;
      const reused = results.filter((r) => r.reused).length;
      const semanticMatches = results.filter((r) => r.semantic_match).length;

      return JSON.stringify({
        message:
          `Procesados ${items.length} items: ${connected} conectados, ${reused} nodos reutilizados, ${semanticMatches} matches semánticos`,
        results,
        details_updated: !skip_details_regeneration,
      });
    } catch (error) {
      console.error("[batch_add_info_to_graph] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "batch_add_info_to_graph",
    description:
      `Añade MÚLTIPLES items de información a un contacto EN UNA SOLA LLAMADA.

MUY EFICIENTE: Solo regenera details UNA VEZ al final.

Usa esta herramienta cuando tengas 2+ items que añadir al mismo contacto.`,
    schema: z.object({
      user_id: z.string().describe("UUID del usuario propietario"),
      node_id: z.string().describe("UUID del nodo CONTACT"),
      contact_id: z.string().describe(
        "UUID del contacto (para regenerar details)",
      ),
      items: z
        .array(
          z.object({
            label: z.string().describe('Etiqueta (ej: "pádel")'),
            concept_category: z.string().describe('Categoría (ej: "Hobby")'),
            relation_type: z.string().describe('Relación (ej: "PRACTICA")'),
          }),
        )
        .describe("Array de items a añadir"),
      skip_details_regeneration: z
        .boolean()
        .describe(
          "Si true, no regenera details. Usar SIEMPRE que se esté en modo CONTACT_DETAILS_UPDATE.",
        ),
    }),
  },
);

export const create_concept_relationship = tool(
  async ({
    user_id,
    source_label,
    source_category,
    target_label,
    target_category,
    relation_type,
  }: {
    user_id: string;
    source_label: string;
    source_category: string;
    target_label: string;
    target_category: string;
    relation_type: string;
  }) => {
    try {
      let { data: sourceNode } = await supabase
        .from("semantic_nodes")
        .select("id")
        .eq("user_id", user_id)
        .eq("type", "CONCEPT")
        .ilike("label", source_label)
        .maybeSingle();

      if (!sourceNode) {
        const { data: newSource, error: sourceError } = await supabase
          .from("semantic_nodes")
          .insert({
            user_id,
            type: "CONCEPT" as NodeType,
            label: source_label,
            concept_category: source_category,
            weight: 1,
          })
          .select("id")
          .single();

        if (sourceError) throw new Error(sourceError.message);
        sourceNode = newSource;
      }

      let { data: targetNode } = await supabase
        .from("semantic_nodes")
        .select("id")
        .eq("user_id", user_id)
        .eq("type", "CONCEPT")
        .ilike("label", target_label)
        .maybeSingle();

      if (!targetNode) {
        const { data: newTarget, error: targetError } = await supabase
          .from("semantic_nodes")
          .insert({
            user_id,
            type: "CONCEPT" as NodeType,
            label: target_label,
            concept_category: target_category,
            weight: 1,
          })
          .select("id")
          .single();

        if (targetError) throw new Error(targetError.message);
        targetNode = newTarget;
      }

      const { data: existingEdge } = await supabase
        .from("semantic_edges")
        .select("id")
        .eq("source_id", sourceNode.id)
        .eq("target_id", targetNode.id)
        .eq("user_id", user_id)
        .maybeSingle();

      if (existingEdge) {
        return JSON.stringify({
          status: "already_exists",
          message:
            `La relación "${source_label}" → "${target_label}" ya existe`,
          edge_id: existingEdge.id,
        });
      }

      const { data: newEdge, error: edgeError } = await supabase
        .from("semantic_edges")
        .insert({
          user_id,
          source_id: sourceNode.id,
          target_id: targetNode.id,
          relation_type,
        })
        .select("id")
        .single();

      if (edgeError) throw new Error(edgeError.message);

      return JSON.stringify({
        status: "created",
        message:
          `Relación creada: "${source_label}" ${relation_type} "${target_label}"`,
        edge_id: newEdge.id,
        source_node_id: sourceNode.id,
        target_node_id: targetNode.id,
      });
    } catch (error) {
      console.error("[create_concept_relationship] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "create_concept_relationship",
    description: `Crea una relación entre dos CONCEPTOS (no contactos).

EJEMPLOS DE USO:
- "Marco Aurelio" ES_FIGURA_DE "estoicismo"
- "filosofía helenística" ES_PARTE_DE "filosofía"
- "muay thai" RELACIONADO_CON "K1"

Esto enriquece el grafo y permite descubrir interconexiones transitivas.`,
    schema: z.object({
      user_id: z.string().describe("UUID del usuario propietario"),
      source_label: z.string().describe(
        'Etiqueta del concepto origen (ej: "Marco Aurelio")',
      ),
      source_category: z.string().describe(
        'Categoría del origen (ej: "Persona histórica")',
      ),
      target_label: z.string().describe(
        'Etiqueta del concepto destino (ej: "estoicismo")',
      ),
      target_category: z.string().describe(
        'Categoría del destino (ej: "Filosofía")',
      ),
      relation_type: z.string().describe(
        'Tipo de relación: "ES_FIGURA_DE", "ES_PARTE_DE", "RELACIONADO_CON", etc.',
      ),
    }),
  },
);
