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

type SemanticEdge = {
  user_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
};

export type { NodeType, SemanticEdge, SemanticNode, SimilarNode };
