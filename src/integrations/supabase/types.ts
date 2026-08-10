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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      alert_cooldowns: {
        Row: {
          last_alert_at: string
          last_score: number
          last_stage: string | null
          symbol: string
        }
        Insert: {
          last_alert_at?: string
          last_score?: number
          last_stage?: string | null
          symbol: string
        }
        Update: {
          last_alert_at?: string
          last_score?: number
          last_stage?: string | null
          symbol?: string
        }
        Relationships: []
      }
      alert_history: {
        Row: {
          alert_price: number
          alerted_at: string
          id: string
          max_runup_pct: number
          score: number | null
          stage: string | null
          symbol: string
          tracking_done: boolean
        }
        Insert: {
          alert_price: number
          alerted_at?: string
          id?: string
          max_runup_pct?: number
          score?: number | null
          stage?: string | null
          symbol: string
          tracking_done?: boolean
        }
        Update: {
          alert_price?: number
          alerted_at?: string
          id?: string
          max_runup_pct?: number
          score?: number | null
          stage?: string | null
          symbol?: string
          tracking_done?: boolean
        }
        Relationships: []
      }
      scan_runs: {
        Row: {
          alerts_sent: number
          created_at: string
          duration_ms: number
          error: string | null
          id: string
          passed_gates: number
          scanned: number
        }
        Insert: {
          alerts_sent?: number
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          passed_gates?: number
          scanned?: number
        }
        Update: {
          alerts_sent?: number
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          passed_gates?: number
          scanned?: number
        }
        Relationships: []
      }
      trade_events: {
        Row: {
          created_at: string
          detail: string | null
          event: string
          id: string
          symbol: string
          trade_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          event: string
          id?: string
          symbol: string
          trade_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          event?: string
          id?: string
          symbol?: string
          trade_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_events_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "weex_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      weex_trades: {
        Row: {
          alert_price: number
          alerted_at: string
          close_price: number | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          entry_order_id: string | null
          entry_price: number | null
          fill_price: number | null
          filled_at: string | null
          id: string
          last_error: string | null
          placed_at: string | null
          quantity: number | null
          realized_pnl: number | null
          sl_order_id: string | null
          status: string
          stop_price: number | null
          symbol: string
          target_price: number | null
          tp_order_id: string | null
          updated_at: string
          velocity_pct: number | null
        }
        Insert: {
          alert_price: number
          alerted_at?: string
          close_price?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          entry_order_id?: string | null
          entry_price?: number | null
          fill_price?: number | null
          filled_at?: string | null
          id?: string
          last_error?: string | null
          placed_at?: string | null
          quantity?: number | null
          realized_pnl?: number | null
          sl_order_id?: string | null
          status?: string
          stop_price?: number | null
          symbol: string
          target_price?: number | null
          tp_order_id?: string | null
          updated_at?: string
          velocity_pct?: number | null
        }
        Update: {
          alert_price?: number
          alerted_at?: string
          close_price?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          entry_order_id?: string | null
          entry_price?: number | null
          fill_price?: number | null
          filled_at?: string | null
          id?: string
          last_error?: string | null
          placed_at?: string | null
          quantity?: number | null
          realized_pnl?: number | null
          sl_order_id?: string | null
          status?: string
          stop_price?: number | null
          symbol?: string
          target_price?: number | null
          tp_order_id?: string | null
          updated_at?: string
          velocity_pct?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
