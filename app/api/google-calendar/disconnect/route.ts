import { NextResponse } from 'next/server';
import { requireAgencyAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  await requireAgencyAdmin();
  const { origin } = new URL(request.url);
  const form = await request.formData();
  const id = form.get('id') as string;
  const supabase = createClient();
  await supabase.from('google_calendar_connections').delete().eq('id', id);
  return NextResponse.redirect(new URL('/ajustes', origin));
}
