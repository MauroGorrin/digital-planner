export type UserRole = 'agency_admin' | 'agency_member' | 'client';

export type PlatformType =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'linkedin'
  | 'twitter_x'
  | 'youtube'
  | 'pinterest'
  | 'otra';

export type ContentFormat = 'post' | 'reel' | 'historia' | 'carrusel' | 'video' | 'otro';

export type ContentStatus =
  | 'borrador'
  | 'pendiente_revision_interna'
  | 'pendiente_revision'
  | 'cambios_solicitados'
  | 'aprobado'
  | 'programado'
  | 'publicado'
  | 'cancelado';

export const STATUS_LABELS: Record<ContentStatus, string> = {
  borrador: 'Borrador',
  pendiente_revision_interna: 'Revisión interna',
  pendiente_revision: 'Pendiente de revisión',
  cambios_solicitados: 'Cambios solicitados',
  aprobado: 'Aprobado',
  programado: 'Programado',
  publicado: 'Publicado',
  cancelado: 'Cancelado',
};

export const STATUS_COLORS: Record<ContentStatus, string> = {
  borrador: 'bg-slate-200 text-slate-700',
  pendiente_revision_interna: 'bg-violet-100 text-violet-800',
  pendiente_revision: 'bg-amber-100 text-amber-800',
  cambios_solicitados: 'bg-red-100 text-red-700',
  aprobado: 'bg-green-100 text-green-700',
  programado: 'bg-blue-100 text-blue-700',
  publicado: 'bg-emerald-100 text-emerald-800',
  cancelado: 'bg-zinc-200 text-zinc-600',
};

export const PLATFORM_LABELS: Record<PlatformType, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  twitter_x: 'X (Twitter)',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  otra: 'Otra',
};

export const PLATFORM_COLORS: Record<PlatformType, string> = {
  instagram: '#e1306c',
  facebook: '#1877f2',
  tiktok: '#111111',
  linkedin: '#0a66c2',
  twitter_x: '#000000',
  youtube: '#ff0000',
  pinterest: '#e60023',
  otra: '#64748b',
};

export const FORMAT_LABELS: Record<ContentFormat, string> = {
  post: 'Post',
  reel: 'Reel',
  historia: 'Historia',
  carrusel: 'Carrusel',
  video: 'Video',
  otro: 'Otro',
};

export interface Agency {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  /**
   * La agencia a la que pertenece el personal de agencia. Nulo en un contacto de cliente, que no
   * pertenece a ninguna agencia sino a una o varias marcas (por `client_contacts`). El check
   * `profiles_agency_id_rol_check` de `0009_agencias.sql` amarra las dos mitades de esa regla.
   */
  agency_id: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
}

export type ClientBillingMode = 'paquete' | 'libre';

export const BILLING_MODE_LABELS: Record<ClientBillingMode, string> = {
  paquete: 'Por paquete',
  libre: 'Libre (sin cuota)',
};

export interface Client {
  id: string;
  name: string;
  /** No es anulable: una marca siempre pertenece a una agencia (`not null` en la base). */
  agency_id: string;
  brand_name: string;
  timezone: string;
  logo_url: string | null;
  notes: string | null;
  archived: boolean;
  billing_mode: ClientBillingMode;
  created_by: string | null;
  created_at: string;
}

export interface ContentPiece {
  id: string;
  client_id: string;
  platform: PlatformType;
  format: ContentFormat;
  title: string;
  copy_text: string;
  reference_link: string | null;
  scheduled_at: string;
  status: ContentStatus;
  assignee_id: string | null;
  created_by: string | null;
  duplicated_from: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'name' | 'brand_name' | 'timezone'>;
  assignee?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface Attachment {
  id: string;
  content_piece_id: string;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  replaces_id: string | null;
  review_round: number;
  created_at: string;
}

export interface Comment {
  id: string;
  content_piece_id: string;
  author_id: string | null;
  body: string;
  parent_comment_id: string | null;
  attachment_id: string | null;
  video_segundo: number | null;
  created_at: string;
  author?: Pick<Profile, 'id' | 'full_name' | 'role'> | null;
}

export interface StatusHistoryEntry {
  id: string;
  content_piece_id: string;
  from_status: ContentStatus | null;
  to_status: ContentStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
  changed_by_profile?: Pick<Profile, 'full_name'> | null;
}

export interface WebhookConfig {
  id: string;
  name: string;
  /**
   * No es anulable: un webhook siempre pertenece a una agencia (`not null` en la base desde
   * `0010_aislamiento_por_agencia.sql`). La columna tiene `default mi_agencia()`, así que la app no
   * la manda al crear el webhook — la deduce la base de la sesión, y así no se puede falsificar.
   */
  agency_id: string;
  url: string;
  active: boolean;
  events: string[];
  created_at: string;
}

export type IdeaStatus =
  | 'propuesta'
  | 'correccion_interna'
  | 'pendiente_cliente'
  | 'correccion_cliente'
  | 'aprobada'
  | 'descartada'
  | 'convertida';

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  propuesta: 'Propuesta',
  correccion_interna: 'Corrección interna',
  pendiente_cliente: 'Pendiente del cliente',
  correccion_cliente: 'Corrección del cliente',
  aprobada: 'Aprobada',
  descartada: 'Descartada',
  convertida: 'Convertida en pieza',
};

export interface Idea {
  id: string;
  client_id: string;
  title: string;
  description: string;
  reference_link: string | null;
  suggested_platform: PlatformType | null;
  suggested_format: ContentFormat | null;
  status: IdeaStatus;
  created_by: string | null;
  content_piece_id: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'name' | 'brand_name'> | null;
  author?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface IdeaStatusHistoryEntry {
  id: string;
  idea_id: string;
  from_status: IdeaStatus | null;
  to_status: IdeaStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
  changed_by_profile?: Pick<Profile, 'full_name'> | null;
}

/** Cuota mensual contratada de un formato para una marca. Clave primaria: (client_id, format). */
export interface ClientPackage {
  client_id: string;
  format: ContentFormat;
  monthly_quota: number;
  created_at: string;
  updated_at: string;
}
