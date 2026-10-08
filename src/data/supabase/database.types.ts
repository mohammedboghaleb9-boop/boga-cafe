/**
 * Types of the live database, generated from the Supabase project (generate
 * types) after the last migration. Regenerate after every schema change.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      admin_config: {
        Row: { admin_email: string; admin_whatsapp: string; email_on: boolean; id: number; whatsapp_on: boolean };
        Insert: { admin_email?: string; admin_whatsapp?: string; email_on?: boolean; id?: number; whatsapp_on?: boolean };
        Update: { admin_email?: string; admin_whatsapp?: string; email_on?: boolean; id?: number; whatsapp_on?: boolean };
        Relationships: [];
      };
      admin_users: {
        Row: { created_at: string; full_name: string; role: string; user_id: string };
        Insert: { created_at?: string; full_name?: string; role: string; user_id: string };
        Update: { created_at?: string; full_name?: string; role?: string; user_id?: string };
        Relationships: [];
      };
      notification_outbox: {
        Row: {
          attempts: number;
          body: string;
          channel: string;
          created_at: string;
          event: string;
          id: number;
          last_error: string | null;
          recipient: string;
          sent_at: string | null;
          status: string;
          subject: string;
        };
        Insert: {
          attempts?: number;
          body: string;
          channel: string;
          created_at?: string;
          event: string;
          id?: never;
          last_error?: string | null;
          recipient: string;
          sent_at?: string | null;
          status?: string;
          subject?: string;
        };
        Update: {
          attempts?: number;
          body?: string;
          channel?: string;
          created_at?: string;
          event?: string;
          id?: never;
          last_error?: string | null;
          recipient?: string;
          sent_at?: string | null;
          status?: string;
          subject?: string;
        };
        Relationships: [];
      };
      order_events: {
        Row: { actor: string | null; at: string; id: number; label: string; order_id: string };
        Insert: { actor?: string | null; at?: string; id?: never; label: string; order_id: string };
        Update: { actor?: string | null; at?: string; id?: never; label?: string; order_id?: string };
        Relationships: [
          {
            foreignKeyName: 'order_events_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          address: string;
          city_id: string;
          company: string;
          created_at: string;
          customer_name: string;
          email: string;
          id: string;
          idempotency_key: string | null;
          lines: Json;
          locale: string;
          notes: string;
          number: string;
          payment_method: string;
          payment_ref: string | null;
          payment_status: string;
          phone: string;
          shipping_fee: number;
          status: string;
          stock_deductions: Json;
          stock_returned: boolean;
          subtotal: number;
          total: number;
          weight_kg: number;
        };
        Insert: {
          address: string;
          city_id: string;
          company?: string;
          created_at?: string;
          customer_name: string;
          email?: string;
          id?: string;
          idempotency_key?: string | null;
          lines: Json;
          locale?: string;
          notes?: string;
          number: string;
          payment_method: string;
          payment_ref?: string | null;
          payment_status?: string;
          phone: string;
          shipping_fee: number;
          status?: string;
          stock_deductions: Json;
          stock_returned?: boolean;
          subtotal: number;
          total: number;
          weight_kg: number;
        };
        Update: {
          address?: string;
          city_id?: string;
          company?: string;
          created_at?: string;
          customer_name?: string;
          email?: string;
          id?: string;
          idempotency_key?: string | null;
          lines?: Json;
          locale?: string;
          notes?: string;
          number?: string;
          payment_method?: string;
          payment_ref?: string | null;
          payment_status?: string;
          phone?: string;
          shipping_fee?: number;
          status?: string;
          stock_deductions?: Json;
          stock_returned?: boolean;
          subtotal?: number;
          total?: number;
          weight_kg?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_city_id_fkey';
            columns: ['city_id'];
            isOneToOne: false;
            referencedRelation: 'shipping_rates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_payment_method_fkey';
            columns: ['payment_method'];
            isOneToOne: false;
            referencedRelation: 'payment_methods';
            referencedColumns: ['id'];
          },
        ];
      };
      origins: {
        Row: {
          active: boolean;
          country_code: string;
          custom_blend_enabled: boolean;
          id: string;
          low_stock_kg: number;
          name: Json;
          price_per_kg: number;
          region: string;
          restock_date: string | null;
          roast_level: string;
          species: string;
          stock_kg: number;
          tasting_notes: Json;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          country_code: string;
          custom_blend_enabled?: boolean;
          id: string;
          low_stock_kg?: number;
          name: Json;
          price_per_kg: number;
          region?: string;
          restock_date?: string | null;
          roast_level: string;
          species: string;
          stock_kg?: number;
          tasting_notes?: Json;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          country_code?: string;
          custom_blend_enabled?: boolean;
          id?: string;
          low_stock_kg?: number;
          name?: Json;
          price_per_kg?: number;
          region?: string;
          restock_date?: string | null;
          roast_level?: string;
          species?: string;
          stock_kg?: number;
          tasting_notes?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_methods: {
        Row: { enabled: boolean; id: string; instructions: Json; label: Json };
        Insert: { enabled?: boolean; id: string; instructions?: Json; label: Json };
        Update: { enabled?: boolean; id?: string; instructions?: Json; label?: Json };
        Relationships: [];
      };
      product_recipes: {
        Row: { origin_id: string; percent: number; product_id: string };
        Insert: { origin_id: string; percent: number; product_id: string };
        Update: { origin_id?: string; percent?: number; product_id?: string };
        Relationships: [
          {
            foreignKeyName: 'product_recipes_origin_id_fkey';
            columns: ['origin_id'];
            isOneToOne: false;
            referencedRelation: 'origins';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_recipes_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          active: boolean;
          description: Json;
          featured: boolean;
          id: string;
          image_url: string | null;
          kind: string;
          name: Json;
          prices: Json;
          roast_level: string;
          slug: string;
          sort_order: number;
          tagline: Json;
          tasting_notes: Json;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          description?: Json;
          featured?: boolean;
          id: string;
          image_url?: string | null;
          kind: string;
          name: Json;
          prices?: Json;
          roast_level: string;
          slug: string;
          sort_order?: number;
          tagline?: Json;
          tasting_notes?: Json;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          description?: Json;
          featured?: boolean;
          id?: string;
          image_url?: string | null;
          kind?: string;
          name?: Json;
          prices?: Json;
          roast_level?: string;
          slug?: string;
          sort_order?: number;
          tagline?: Json;
          tasting_notes?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      quote_requests: {
        Row: {
          admin_notes: string;
          business_type: string;
          city_id: string;
          company: string;
          contact_name: string;
          created_at: string;
          email: string;
          final_price: number | null;
          id: string;
          indicative_total: number;
          lines: Json;
          notes: string;
          number: string;
          phone: string;
          status: string;
          weight_kg: number;
        };
        Insert: {
          admin_notes?: string;
          business_type: string;
          city_id: string;
          company?: string;
          contact_name: string;
          created_at?: string;
          email?: string;
          final_price?: number | null;
          id?: string;
          indicative_total: number;
          lines: Json;
          notes?: string;
          number: string;
          phone: string;
          status?: string;
          weight_kg: number;
        };
        Update: {
          admin_notes?: string;
          business_type?: string;
          city_id?: string;
          company?: string;
          contact_name?: string;
          created_at?: string;
          email?: string;
          final_price?: number | null;
          id?: string;
          indicative_total?: number;
          lines?: Json;
          notes?: string;
          number?: string;
          phone?: string;
          status?: string;
          weight_kg?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_requests_city_id_fkey';
            columns: ['city_id'];
            isOneToOne: false;
            referencedRelation: 'shipping_rates';
            referencedColumns: ['id'];
          },
        ];
      };
      rate_limits: {
        Row: { bucket: string; hits: number; window_start: string };
        Insert: { bucket: string; hits?: number; window_start?: string };
        Update: { bucket?: string; hits?: number; window_start?: string };
        Relationships: [];
      };
      shipping_rates: {
        Row: {
          active: boolean;
          base_fee: number;
          city: Json;
          delivery_days: string;
          distance_km: number;
          extra_per_kg: number;
          id: string;
          included_kg: number;
        };
        Insert: {
          active?: boolean;
          base_fee: number;
          city: Json;
          delivery_days?: string;
          distance_km?: number;
          extra_per_kg?: number;
          id: string;
          included_kg?: number;
        };
        Update: {
          active?: boolean;
          base_fee?: number;
          city?: Json;
          delivery_days?: string;
          distance_km?: number;
          extra_per_kg?: number;
          id?: string;
          included_kg?: number;
        };
        Relationships: [];
      };
      site_config: {
        Row: { content: Json; id: number; settings: Json };
        Insert: { content: Json; id?: number; settings: Json };
        Update: { content?: Json; id?: number; settings?: Json };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          actor: string | null;
          at: string;
          delta_kg: number;
          id: number;
          note: string;
          origin_id: string;
          reason: string;
          ref: string;
        };
        Insert: {
          actor?: string | null;
          at?: string;
          delta_kg: number;
          id?: never;
          note?: string;
          origin_id: string;
          reason: string;
          ref?: string;
        };
        Update: {
          actor?: string | null;
          at?: string;
          delta_kg?: number;
          id?: never;
          note?: string;
          origin_id?: string;
          reason?: string;
          ref?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_movements_origin_id_fkey';
            columns: ['origin_id'];
            isOneToOne: false;
            referencedRelation: 'origins';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      adjust_stock: {
        Args: { p_delta_kg: number; p_note?: string; p_origin_id: string; p_reason: string };
        Returns: number;
      };
      admin_role: { Args: never; Returns: string };
      check_order: { Args: { p_order: Json }; Returns: Json };
      commit_order: {
        Args: { p_email: string; p_idempotency_key?: string; p_order: Json; p_subject: string; p_whatsapp: string };
        Returns: { created: boolean; id: string; number: string }[];
      };
      commit_quote_request: {
        Args: { p_email: string; p_quote: Json; p_subject: string; p_whatsapp: string };
        Returns: { id: string; number: string }[];
      };
      expire_unpaid_orders: { Args: never; Returns: number };
      get_order_public: {
        Args: { p_order_id: string };
        Returns: {
          city_id: string;
          created_at: string;
          customer_name: string;
          lines: Json;
          number: string;
          payment_method: string;
          payment_status: string;
          shipping_fee: number;
          status: string;
          subtotal: number;
          total: number;
          weight_kg: number;
        }[];
      };
      is_admin: { Args: { allowed?: string[] }; Returns: boolean };
      queue_notification: {
        Args: { p_email: string; p_event: string; p_subject: string; p_whatsapp: string };
        Returns: undefined;
      };
      rate_limit_hit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      report_offline_payment: { Args: { p_order_id: string; p_ref: string }; Returns: undefined };
      set_order_status: { Args: { p_order_id: string; p_status: string }; Returns: undefined };
      set_payment_status: { Args: { p_order_id: string; p_status: string }; Returns: undefined };
      update_quote_request: {
        Args: { p_admin_notes: string; p_final_price: number | null; p_id: string; p_status: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type FunctionReturns<F extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][F]['Returns'];
