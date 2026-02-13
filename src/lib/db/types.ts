export type UUID = string;

export type ProfileRow = {
  id: UUID;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_image_path: string | null;
  is_pro: boolean;
  created_at: string;
  updated_at: string;
};

export type VehicleRow = {
  id: UUID;
  profile_id: UUID;
  name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  hero_image_path: string | null;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ModRow = {
  id: UUID;
  vehicle_id: UUID;
  title: string;
  category: string | null;
  cost_cents: number | null;
  notes: string | null;
  installed_on: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ImageRow = {
  id: UUID;
  profile_id: UUID;
  vehicle_id: UUID | null;
  mod_id: UUID | null;
  storage_bucket: string;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

export type ProfileInsert = {
  id: UUID;
  username?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_image_path?: string | null;
  is_pro?: boolean;
};

export type ProfileUpdate = Partial<Omit<ProfileInsert, "id">>;

export type VehicleInsert = {
  profile_id: UUID;
  name: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  hero_image_path?: string | null;
  is_public?: boolean;
  sort_order?: number;
};

export type VehicleUpdate = Partial<Omit<VehicleInsert, "profile_id">>;

export type ModInsert = {
  vehicle_id: UUID;
  title: string;
  category?: string | null;
  cost_cents?: number | null;
  notes?: string | null;
  installed_on?: string | null;
  sort_order?: number;
};

export type ModUpdate = Partial<Omit<ModInsert, "vehicle_id">>;

export type ImageInsert = {
  profile_id: UUID;
  vehicle_id?: UUID | null;
  mod_id?: UUID | null;
  storage_bucket?: string;
  storage_path: string;
  caption?: string | null;
  sort_order?: number;
};

export type ImageUpdate = Partial<Omit<ImageInsert, "profile_id">>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
      vehicles: {
        Row: VehicleRow;
        Insert: VehicleInsert;
        Update: VehicleUpdate;
        Relationships: [
          {
            foreignKeyName: "vehicles_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      mods: {
        Row: ModRow;
        Insert: ModInsert;
        Update: ModUpdate;
        Relationships: [
          {
            foreignKeyName: "mods_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          }
        ];
      };
      images: {
        Row: ImageRow;
        Insert: ImageInsert;
        Update: ImageUpdate;
        Relationships: [
          {
            foreignKeyName: "images_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "images_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "images_mod_id_fkey";
            columns: ["mod_id"];
            isOneToOne: false;
            referencedRelation: "mods";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
