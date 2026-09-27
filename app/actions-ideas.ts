'use server';

import { revalidatePath } from 'next/cache';
import { requireAgency, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { enlaceDeReferenciaValidado } from '@/lib/url-segura';
import type { ContentFormat, PlatformType } from '@/types/database';
import { errorParaElCliente } from '@/lib/errores';

async function llamar(rpc: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) throw errorParaElCliente(error, rpc);
  revalidatePath('/ideas');
  revalidatePath('/pendientes');
}

export async function crearIdea(input: {
  client_id: string;
  title: string;
  description: string;
  reference_link?: string;
  suggested_platform?: PlatformType;
  suggested_format?: ContentFormat;
}) {
  const profile = await requireAgency();
  const supabase = await createClient();
  const { error } = await supabase.from('ideas').insert({
    client_id: input.client_id,
    title: input.title,
    description: input.description,
    // Ver CN-008 en lib/url-segura.ts: el enlace de una idea se pinta en un href igual que el de
    // una pieza, y lo abre el contacto del cliente en el origen de la app.
    reference_link: enlaceDeReferenciaValidado(input.reference_link),
    suggested_platform: input.suggested_platform ?? null,
    suggested_format: input.suggested_format ?? null,
    created_by: profile.id,
  });
  if (error) throw errorParaElCliente(error, 'crearIdea');
  revalidatePath('/ideas');
}

export async function enviarIdeaAlCliente(id: string) {
  await requireAgency();
  await llamar('submit_idea_to_client', { p_idea_id: id });
}

export async function pedirCorreccionInterna(id: string, note: string) {
  await requireAgency();
  await llamar('request_idea_internal_changes', { p_idea_id: id, p_note: note });
}

export async function aprobarIdea(id: string, note?: string) {
  await requireProfile();
  await llamar('approve_idea', { p_idea_id: id, p_note: note ?? null });
}

export async function pedirCorreccionDelCliente(id: string, note: string) {
  await requireProfile();
  await llamar('request_idea_client_changes', { p_idea_id: id, p_note: note });
}

export async function descartarIdea(id: string, reason: string) {
  await requireProfile();
  await llamar('discard_idea', { p_idea_id: id, p_reason: reason });
}

export async function reenviarIdea(id: string) {
  await requireAgency();
  await llamar('resubmit_idea', { p_idea_id: id });
}

export async function vincularIdeaAPieza(ideaId: string, pieceId: string) {
  await requireAgency();
  await llamar('convert_idea_to_piece', { p_idea_id: ideaId, p_content_piece_id: pieceId });
}
