import { traceable } from "langsmith/traceable";
import { supabase } from "../lib/supabase.ts";
import { tool } from "langchain";
import { z } from "zod";

import { llm } from "../lib/llm_provider.ts";
import { embeddings } from "../lib/llm_provider.ts";
import { NodeType, SimilarNode } from "../types.ts";
import { EmbeddingCache } from "../lib/embedding_cache.ts";

const SIMILARITY_THRESHOLD_EXACT = 0.90;
const SIMILARITY_THRESHOLD_RELATED = 0.47;

const embeddingCache = new EmbeddingCache();

const generate_embedding = traceable(
  async (
    label: string,
    category: string,
    relation_type: string,
  ): Promise<number[]> => {
    const cached = embeddingCache.get(label, category);
    if (cached) {
      return cached;
    }
    const text = `${label} | ${category} | ${relation_type}`;
    const vector = await embeddings.embedQuery(text);

    embeddingCache.set(label, category, vector);

    console.log(
      `[generate_embedding] Generated embedding for: "${text}" (${vector.length} dims)`,
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
    excludeNodeId?: string[],
    options: {
      minSimilarity?: number;
      limit?: number;
    } = {},
  ): Promise<SimilarNode[]> => {
    const {
      minSimilarity = SIMILARITY_THRESHOLD_RELATED,
      limit = 1,
    } = options;

    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    console.log(
      `[find_similar_nodes] Buscando nodos similares para user_id=${user_id}, umbral=${minSimilarity}`,
    );

    const { data: results, error } = await supabase.rpc(
      "match_semantic_nodes",
      {
        query_embedding: embeddingStr,
        match_threshold: minSimilarity,
        match_count: limit,
        p_user_id: user_id,
      },
    );

    console.log(
      `[find_similar_nodes] RPC resultado: error=${
        error?.message || "null"
      }, data=${JSON.stringify(results)?.substring(0, 200)}`,
    );

    if (!results || !Array.isArray(results)) {
      console.log("[find_similar_nodes] No hay nodos similares");
      return [];
    }

    const filtered = excludeNodeId
      ? results.filter((n: SimilarNode) => !excludeNodeId.includes(n.id))
      : results;
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
- Habla como si hablases al usuario, es decir que por ejemplo si se menciona como se le conoció al contacto entonces di algo como "le conociste en.."
- Nunca empieces con "el contacto...", "la persona..." etc, directamente menciona los datos
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

export const delete_semantic_node = tool(
  async (
    {
      node_id,
      user_id,
      skip_details_regeneration,
      contact_id,
    }: {
      node_id: string;
      user_id: string;
      skip_details_regeneration: boolean;
      contact_id: string;
    },
  ) => {
    try {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(node_id)) {
        throw new Error(
          `UUID inválido para node_id: "${node_id}". Debe ser un UUID completo de 36 caracteres.`,
        );
      }
      if (!uuidRegex.test(user_id)) {
        throw new Error(
          `UUID inválido para user_id: "${user_id}". Debe ser un UUID completo de 36 caracteres.`,
        );
      }

      const { error: deleteNodeError } = await supabase
        .from("semantic_nodes")
        .delete()
        .eq("id", node_id)
        .eq("user_id", user_id);

      if (deleteNodeError) {
        console.error(
          "[delete_semantic_node] Delete Node Error:",
          deleteNodeError.message,
        );
        throw new Error(deleteNodeError.message);
      }

      if (!skip_details_regeneration) {
        await regenerate_contact_details(
          contact_id,
          node_id,
          "",
          false,
        );
      }
    } catch (error) {
      console.error("[delete_semantic_node] Exception:", error);
      throw new Error((error as Error).message);
    }
  },
  {
    name: "delete_semantic_node",
    description:
      "Elimina un nodo. SOLO elimina nodos del node_id especificado, nunca afecta otros nodos.",
    schema: z.object({
      node_id: z.string().describe("El UUID del nodo a eliminar"),
      user_id: z.string().describe("El UUID del usuario propietario"),
      contact_id: z.string().describe("El UUID del contacto propietario"),
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
      console.log(
        `[batch_add_info_to_graph] Processing ${items.length} items for contact ${node_id}`,
      );

      const { data: currentContactEdges } = await supabase
        .from("semantic_edges")
        .select("target_id")
        .eq("source_id", node_id)
        .eq("user_id", user_id);

      const currentContactNodeIds = new Set(
        currentContactEdges?.map((e) => e.target_id) || [],
      );

      const embeddings = await Promise.all(
        items.map((item) =>
          generate_embedding(
            item.label,
            item.concept_category,
            item.relation_type,
          )
        ),
      );

      const itemsWithEmbeddings = items.map((item, index) => ({
        ...item,
        embedding: embeddings[index],
      }));

      const itemsWithMatches = await Promise.all(
        itemsWithEmbeddings.map(async (item) => {
          const matches = await find_similar_nodes(
            user_id,
            item.embedding,
            [node_id],
            {
              minSimilarity: SIMILARITY_THRESHOLD_RELATED,
              limit: 1,
            },
          );
          return {
            ...item,
            matches: matches,
          };
        }),
      );

      let createdCount = 0;
      let connectedCount = 0;

      for (const item of itemsWithMatches) {
        const match = item.matches[0];
        let targetNodeId: string;

        if (match && match.similarity >= SIMILARITY_THRESHOLD_EXACT) {
          targetNodeId = match.id;
          console.log(
            `[batch] Exact match for "${item.label}" -> "${match.label}"`,
          );
        } else {
          const { data: newNode, error: insertError } = await supabase
            .from("semantic_nodes")
            .insert({
              user_id,
              type: "CONCEPT",
              label: item.label,
              concept_category: item.concept_category,
              weight: 1,
              embedding: item.embedding,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error(
              `[batch] Error creating node for ${item.label}:`,
              insertError.message,
            );
            continue;
          }
          targetNodeId = newNode.id;
          createdCount++;

          if (match && match.similarity >= SIMILARITY_THRESHOLD_RELATED) {
            await supabase.from("semantic_edges").insert({
              user_id,
              source_id: targetNodeId,
              target_id: match.id,
              relation_type: "RELACIONADO_CON",
            });
            console.log(
              `[batch] Created relation "${item.label}" -> "${match.label}"`,
            );
          }
        }
        if (currentContactNodeIds.has(targetNodeId)) {
          console.log(`[batch] Contact already connected to ${targetNodeId}`);
          continue;
        }

        const { error: edgeError } = await supabase
          .from("semantic_edges")
          .insert({
            user_id,
            source_id: node_id,
            target_id: targetNodeId,
            relation_type: item.relation_type,
          });

        if (edgeError) {
          console.error(
            `[batch] Error connecting contact to ${targetNodeId}:`,
            edgeError.message,
          );
        } else {
          connectedCount++;
          currentContactNodeIds.add(targetNodeId);
        }
      }

      if (!skip_details_regeneration) {
        await regenerate_contact_details(contact_id, node_id, "", false);
      }

      return `Procesados ${items.length} items. Creados ${createdCount} nodos. Conectados ${connectedCount} items.`;
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
            relation_type: z.string().describe(
              "Tipo de la relación entre los dos nodos ESCOGER LA QUE MEJOR SE AJUSTE AL TEXTO DE LA PETICIÓN",
            ),
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
