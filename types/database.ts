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
  | 'pendiente_revision'
  | 'cambios_solicitados'
  | 'aprobado'
  | 'programado'
  | 'publicado'
  | 'cancelado';

export const STATUS_LABELS: Record<ContentStatus, string> = {
  borrador: 'Borrador',
  pendiente_revision: 'Pendiente de revisión',
  cambios_solicitados: 'Cambios solicitados',
  aprobado: 'Aprobado',
  programado: 'Programado',
  publicado: 'Publicado',
  cancelado: 'Cancelado',
};

export const STATUS_COLORS: Record<ContentStatus, string> = {
  borrador: 'bg-slate-200 text-slate-700',
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

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  brand_name: string;
  timezone: string;
  logo_url: string | null;
  notes: string | null;
  archived: boolean;
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
  url: string;
  active: boolean;
  events: string[];
  created_at: string;
}
