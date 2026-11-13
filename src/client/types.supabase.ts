export type AppRole = "admin" | "landlord" | "tenant" | "maintenance";
export type AccountStatus = "pending" | "approved" | "rejected" | "suspended";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      user_roles: {
        Row: {
          user_id: string;
          role: AppRole;
          landlord_id: number | null;
          tenant_id: number | null;
          staff_id: number | null;
          created_at: string;
          account_status: AccountStatus;
        };
        Insert: {
          user_id: string;
          role: AppRole;
          landlord_id?: number | null;
          tenant_id?: number | null;
          staff_id?: number | null;
          created_at?: string;
          account_status?: AccountStatus;
        };
        Update: Partial<Database["public"]["Tables"]["user_roles"]["Insert"]>;
        Relationships: [];
      };
      Landlords: {
        Row: {
          id: number;
          created_at: string;
          source_id: string;
          first_name: string;
          last_name: string;
          company_name: string | null;
          email: string;
          mobile_phone: string | null;
          preferred_contact: string | null;
          notes: string | null;
          is_test_data: boolean;
        };
        Insert: {
          id?: number;
          created_at?: string;
          source_id?: string;
          first_name: string;
          last_name: string;
          company_name?: string | null;
          email: string;
          mobile_phone?: string | null;
          preferred_contact?: string | null;
          notes?: string | null;
          is_test_data?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["Landlords"]["Insert"]>;
        Relationships: [];
      };
      Properties: {
        Row: {
          id: number;
          created_at: string;
          source_id: string;
          property_name: string | null;
          street_address: string;
          city: string;
          state: string;
          zip: string;
          property_type: string;
          landlord_id: number;
          notes: string | null;
          is_test_data: boolean;
          management_status: string;
          occupancy_status: string;
          management_end_date: string | null;
          year_built: number | null;
          color: string;
        };
        Insert: {
          id?: number;
          created_at?: string;
          source_id?: string;
          property_name?: string | null;
          street_address: string;
          city: string;
          state: string;
          zip: string;
          property_type: string;
          landlord_id: number;
          notes?: string | null;
          is_test_data?: boolean;
          management_status?: string;
          occupancy_status?: string;
          management_end_date?: string | null;
          year_built?: number | null;
          color?: string;
        };
        Update: Partial<Database["public"]["Tables"]["Properties"]["Insert"]>;
        Relationships: [];
      };
      Units: {
        Row: {
          id: number;
          created_at: string;
          source_id: string;
          property_id: number;
          unit_label: string;
          bedrooms: number | null;
          bathrooms: number | null;
          status: string;
          notes: string | null;
          is_test_data: boolean;
          management_status: string;
          occupancy_status: string | null;
          readiness_status: string;
          currently_being_marketed: boolean;
          management_end_date: string | null;
          expected_move_out_date: string | null;
          sqft: number | null;
          market_rent: number;
        };
        Insert: {
          id?: number;
          created_at?: string;
          source_id?: string;
          property_id: number;
          unit_label: string;
          bedrooms?: number | null;
          bathrooms?: number | null;
          status?: string;
          notes?: string | null;
          is_test_data?: boolean;
          management_status?: string;
          occupancy_status?: string | null;
          readiness_status?: string;
          currently_being_marketed?: boolean;
          management_end_date?: string | null;
          expected_move_out_date?: string | null;
          sqft?: number | null;
          market_rent?: number;
        };
        Update: Partial<Database["public"]["Tables"]["Units"]["Insert"]>;
        Relationships: [];
      };
      Tenants: {
        Row: {
          id: number;
          created_at: string;
          source_id: string;
          first_name: string;
          last_name: string;
          email: string;
          mobile_phone: string | null;
          unit_id: number | null;
          primary_on_lease: boolean;
          invite_to_app: boolean;
          notes: string | null;
          is_test_data: boolean;
          date_of_birth: string | null;
          emergency_contact: string | null;
          employer: string | null;
          monthly_income: number | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          source_id?: string;
          first_name: string;
          last_name: string;
          email: string;
          mobile_phone?: string | null;
          unit_id?: number | null;
          primary_on_lease?: boolean;
          invite_to_app?: boolean;
          notes?: string | null;
          is_test_data?: boolean;
          date_of_birth?: string | null;
          emergency_contact?: string | null;
          employer?: string | null;
          monthly_income?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["Tenants"]["Insert"]>;
        Relationships: [];
      };
      Staff: {
        Row: {
          id: number;
          created_at: string;
          first_name: string;
          last_name: string;
          email: string;
          job_title: string | null;
          gets_request_alerts: boolean;
          is_test_data: boolean;
        };
        Insert: {
          id?: number;
          created_at?: string;
          first_name: string;
          last_name: string;
          email: string;
          job_title?: string | null;
          gets_request_alerts?: boolean;
          is_test_data?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["Staff"]["Insert"]>;
        Relationships: [];
      };
      Leases: {
        Row: {
          id: number;
          created_at: string;
          unit_id: number;
          primary_tenant_id: number | null;
          start_date: string;
          end_date: string;
          monthly_rent: number;
          deposit: number;
          rent_due_day: number;
          late_fee: number;
          status: string;
          notes: string | null;
          is_test_data: boolean;
        };
        Insert: {
          id?: number;
          created_at?: string;
          unit_id: number;
          primary_tenant_id?: number | null;
          start_date: string;
          end_date: string;
          monthly_rent?: number;
          deposit?: number;
          rent_due_day?: number;
          late_fee?: number;
          status?: string;
          notes?: string | null;
          is_test_data?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["Leases"]["Insert"]>;
        Relationships: [];
      };
      LeaseTenants: {
        Row: { lease_id: number; tenant_id: number };
        Insert: { lease_id: number; tenant_id: number };
        Update: Partial<Database["public"]["Tables"]["LeaseTenants"]["Insert"]>;
        Relationships: [];
      };
      RentCharges: {
        Row: {
          id: number;
          created_at: string;
          lease_id: number;
          period: string;
          due_date: string;
          amount: number;
          amount_paid: number;
          status: string;
          notes: string | null;
          is_test_data: boolean;
        };
        Insert: {
          id?: number;
          created_at?: string;
          lease_id: number;
          period: string;
          due_date: string;
          amount?: number;
          amount_paid?: number;
          status?: string;
          notes?: string | null;
          is_test_data?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["RentCharges"]["Insert"]>;
        Relationships: [];
      };
      Payments: {
        Row: {
          id: number;
          created_at: string;
          charge_id: number;
          paid_at: string;
          amount: number;
          method: string;
          reference: string | null;
          notes: string | null;
          is_test_data: boolean;
        };
        Insert: {
          id?: number;
          created_at?: string;
          charge_id: number;
          paid_at?: string;
          amount?: number;
          method?: string;
          reference?: string | null;
          notes?: string | null;
          is_test_data?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["Payments"]["Insert"]>;
        Relationships: [];
      };
      Vendors: {
        Row: {
          id: number;
          created_at: string;
          name: string;
          category: string;
          phone: string | null;
          email: string | null;
          notes: string | null;
          color: string;
          is_test_data: boolean;
        };
        Insert: {
          id?: number;
          created_at?: string;
          name: string;
          category?: string;
          phone?: string | null;
          email?: string | null;
          notes?: string | null;
          color?: string;
          is_test_data?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["Vendors"]["Insert"]>;
        Relationships: [];
      };
      Settings: {
        Row: { key: string; value: string; updated_at: string };
        Insert: { key: string; value: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["Settings"]["Insert"]>;
        Relationships: [];
      };
      MaintenanceRequests: {
        Row: {
          id: number;
          request_number: string;
          unit_id: number | null;
          submitted_by_tenant_id: number | null;
          title: string;
          description: string;
          category: string;
          priority: string;
          status: string;
          assigned_staff_id: number | null;
          created_at: string;
          scheduled_for: string | null;
          started_at: string | null;
          hold_reason: string | null;
          next_follow_up_date: string | null;
          closed_at: string | null;
          resolution_notes: string | null;
          is_test_data: boolean;
          property_id: number | null;
          vendor_id: number | null;
          cost: number | null;
          notes: string | null;
          location: string | null;
          permission_to_enter: boolean;
          client_submission_id: string | null;
        };
        Insert: {
          id?: number;
          request_number?: string;
          unit_id?: number | null;
          submitted_by_tenant_id?: number | null;
          title: string;
          description: string;
          category: string;
          priority?: string;
          status?: string;
          assigned_staff_id?: number | null;
          created_at?: string;
          scheduled_for?: string | null;
          started_at?: string | null;
          hold_reason?: string | null;
          next_follow_up_date?: string | null;
          closed_at?: string | null;
          resolution_notes?: string | null;
          is_test_data?: boolean;
          property_id?: number | null;
          vendor_id?: number | null;
          cost?: number | null;
          notes?: string | null;
          location?: string | null;
          permission_to_enter?: boolean;
          client_submission_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["MaintenanceRequests"]["Insert"]>;
        Relationships: [];
      };
      Applications: {
        Row: {
          id: number;
          created_at: string;
          unit_id: number | null;
          first_name: string;
          last_name: string;
          email: string | null;
          phone: string | null;
          monthly_income: number | null;
          employer: string | null;
          desired_move_in: string | null;
          status: string;
          notes: string | null;
          is_test_data: boolean;
        };
        Insert: {
          id?: number;
          created_at?: string;
          unit_id?: number | null;
          first_name: string;
          last_name: string;
          email?: string | null;
          phone?: string | null;
          monthly_income?: number | null;
          employer?: string | null;
          desired_move_in?: string | null;
          status?: string;
          notes?: string | null;
          is_test_data?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["Applications"]["Insert"]>;
        Relationships: [];
      };
      MaintenanceRequestPhotos: {
        Row: {
          id: number;
          created_at: string;
          maintenance_request_id: number;
          storage_path: string;
          uploaded_by_role: AppRole | null;
          uploaded_by_user_id: string | null;
          caption: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          maintenance_request_id: number;
          storage_path: string;
          uploaded_by_role?: AppRole | null;
          uploaded_by_user_id?: string | null;
          caption?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["MaintenanceRequestPhotos"]["Insert"]>;
        Relationships: [];
      };
      MaintenanceRequestComments: {
        Row: {
          id: number;
          created_at: string;
          maintenance_request_id: number;
          author_user_id: string | null;
          author_role: AppRole | null;
          author_staff_id: number | null;
          author_tenant_id: number | null;
          body: string;
          visibility: string;
        };
        Insert: {
          id?: number;
          created_at?: string;
          maintenance_request_id: number;
          author_user_id?: string | null;
          author_role?: AppRole | null;
          author_staff_id?: number | null;
          author_tenant_id?: number | null;
          body: string;
          visibility?: string;
        };
        Update: Partial<Database["public"]["Tables"]["MaintenanceRequestComments"]["Insert"]>;
        Relationships: [];
      };
      MaintenanceRequestStatusHistory: {
        Row: {
          id: number;
          created_at: string;
          maintenance_request_id: number;
          from_status: string | null;
          to_status: string;
          changed_by_user_id: string | null;
          changed_by_role: AppRole | null;
          note: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          maintenance_request_id: number;
          from_status?: string | null;
          to_status: string;
          changed_by_user_id?: string | null;
          changed_by_role?: AppRole | null;
          note?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["MaintenanceRequestStatusHistory"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      record_payment: {
        Args: {
          p_charge_id: number;
          p_amount: number;
          p_method?: string;
          p_reference?: string | null;
          p_notes?: string | null;
          p_paid_at?: string;
        };
        Returns: Database["public"]["Tables"]["RentCharges"]["Row"];
      };
      delete_payment: {
        Args: { p_payment_id: number };
        Returns: Database["public"]["Tables"]["RentCharges"]["Row"];
      };
      list_user_accounts_for_admin: {
        Args: Record<string, never>;
        Returns: {
          user_id: string;
          email: string | null;
          role: AppRole | null;
          landlord_id: number | null;
          tenant_id: number | null;
          staff_id: number | null;
          account_status: AccountStatus;
          created_at: string;
        }[];
      };
      set_account_status: {
        Args: { p_user_id: string; p_status: string };
        Returns: Database["public"]["Tables"]["user_roles"]["Row"];
      };
      admin_set_user_role: {
        Args: {
          p_user_id: string;
          p_role: AppRole;
          p_landlord_id?: number | null;
          p_tenant_id?: number | null;
          p_staff_id?: number | null;
        };
        Returns: Database["public"]["Tables"]["user_roles"]["Row"];
      };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
