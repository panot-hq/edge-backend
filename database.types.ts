export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      contacts: {
        Row: {
          communication_channels: Json | null
          created_at: string | null
          deleted: boolean | null
          details: Json | null
          first_name: string | null
          id: string
          last_name: string | null
          node_id: string
          owner_id: string
          updated_at: string | null
        }
        Insert: {
          communication_channels?: Json | null
          created_at?: string | null
          deleted?: boolean | null
          details?: Json | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          node_id: string
          owner_id: string
          updated_at?: string | null
        }
        Update: {
          communication_channels?: Json | null
          created_at?: string | null
          deleted?: boolean | null
          details?: Json | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          node_id?: string
          owner_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "semantic_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          contact_id: string | null
          created_at: string
          deleted: boolean | null
          id: string
          owner_id: string
          processed: boolean
          raw_content: string
          updated_at: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          deleted?: boolean | null
          id?: string
          owner_id: string
          processed?: boolean
          raw_content: string
          updated_at?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          deleted?: boolean | null
          id?: string
          owner_id?: string
          processed?: boolean
          raw_content?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          deleted: boolean | null
          onboarding_done: boolean
          subscribed: boolean
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          deleted?: boolean | null
          onboarding_done?: boolean
          subscribed?: boolean
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          deleted?: boolean | null
          onboarding_done?: boolean
          subscribed?: boolean
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      semantic_edges: {
        Row: {
          created_at: string | null
          id: string
          relation_type: string
          source_id: string
          target_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          relation_type: string
          source_id: string
          target_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          relation_type?: string
          source_id?: string
          target_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "semantic_edges_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "semantic_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "semantic_edges_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "semantic_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      semantic_nodes: {
        Row: {
          concept_category: string | null
          created_at: string
          embedding: string | null
          id: string
          label: string
          type: Database["public"]["Enums"]["node_type"]
          user_id: string
          weight: number
        }
        Insert: {
          concept_category?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          label: string
          type: Database["public"]["Enums"]["node_type"]
          user_id: string
          weight?: number
        }
        Update: {
          concept_category?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          label?: string
          type?: Database["public"]["Enums"]["node_type"]
          user_id?: string
          weight?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_shared_connections: {
        Args: { p_contact_id: string; p_user_id: string }
        Returns: Json
      }
      is_my_contact: { Args: { c_id: string }; Returns: boolean }
    }
    Enums: {
      node_type: "CONTACT" | "CONCEPT"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      node_type: ["CONTACT", "CONCEPT"],
    },
  },
} as const
