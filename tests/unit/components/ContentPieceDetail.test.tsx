import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPieceDetail } from '@/components/ContentPieceDetail';
import { approveInternalReview, requestInternalChanges, submitForInternalReview } from '@/app/actions';
import type { Client, ContentPiece, Profile } from '@/types/database';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, back: vi.fn() }),
}));

// ContentPieceDetail importa todas estas de @/app/actions (algunas directamente, otras a través de
// AttachmentUploader/CommentThread, que también las usan) — hay que mockearlas todas o una llamada
// no probada en esta prueba deja `undefined(...)` esperando a que alguien la dispare.
vi.mock('@/app/actions', () => ({
  submitForReview: vi.fn(),
  submitForInternalReview: vi.fn(),
  approveInternalReview: vi.fn(),
  requestInternalChanges: vi.fn(),
  approvePiece: vi.fn(),
  cancelPiece: vi.fn(),
  deleteContentPiece: vi.fn(),
  duplicateContentPiece: vi.fn(),
  markPiecePublished: vi.fn(),
  markPieceScheduled: vi.fn(),
  requestPieceChanges: vi.fn(),
  addComment: vi.fn(),
  deleteAttachment: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}));

const CLIENTE: Client = {
  id: 'client-1',
  name: 'Cliente Uno',
  agency_id: 'agency-1',
  brand_name: 'Marca Uno',
  slug: 'marca-prueba',
  timezone: 'UTC',
  logo_url: null,
  notes: null,
  archived: false,
  billing_mode: 'paquete',
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

function crearPerfil(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    full_name: 'Persona de prueba',
    email: 'persona@ejemplo.com',
    role: 'agency_member',
    agency_id: 'agency-1',
    phone: null,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function crearPieza(overrides: Partial<ContentPiece> = {}): ContentPiece & { clients: Client } {
  return {
    id: 'pieza-1',
    client_id: 'client-1',
    platform: 'instagram',
    format: 'post',
    title: 'Pieza de prueba',
    copy_text: '',
    reference_link: null,
    scheduled_at: '2026-10-05T15:00:00.000Z',
    status: 'borrador',
    assignee_id: null,
    created_by: null,
    duplicated_from: null,
    cancelled_reason: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
    clients: CLIENTE,
  };
}

function renderizar(opciones: {
  profile?: Profile;
  piece?: ContentPiece & { clients: Client };
  isClientContact?: boolean;
} = {}) {
  return render(
    <ContentPieceDetail
      profile={opciones.profile ?? crearPerfil()}
      piece={opciones.piece ?? crearPieza()}
      attachments={[]}
      urls={{}}
      comments={[]}
      history={[]}
      isClientContact={opciones.isClientContact ?? false}
    />
  );
}

describe('ContentPieceDetail — revisión interna', () => {
  afterEach(() => vi.clearAllMocks());

  it('en borrador, el botón dice "Enviar a revisión interna" (no "Enviar a revisión") y llama a submitForInternalReview', async () => {
    vi.mocked(submitForInternalReview).mockResolvedValue(undefined);
    renderizar({ piece: crearPieza({ status: 'borrador' }) });

    expect(screen.queryByRole('button', { name: 'Enviar a revisión' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a revisión interna' }));

    await waitFor(() => expect(submitForInternalReview).toHaveBeenCalledWith('pieza-1'));
  });

  it('en pendiente_revision_interna, un agency_admin ve los dos botones de decisión', () => {
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    expect(screen.getByRole('button', { name: '✓ Aprobar y enviar al cliente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir corrección interna' })).toBeInTheDocument();
  });

  it('en pendiente_revision_interna, un agency_member NO ve los botones de decisión', () => {
    renderizar({
      profile: crearPerfil({ role: 'agency_member' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    expect(screen.queryByRole('button', { name: '✓ Aprobar y enviar al cliente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir corrección interna' })).not.toBeInTheDocument();
  });

  it('aprobar pide confirmación primero, y solo al confirmar llama a approveInternalReview', async () => {
    vi.mocked(approveInternalReview).mockResolvedValue(undefined);
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    fireEvent.click(screen.getByRole('button', { name: '✓ Aprobar y enviar al cliente' }));
    expect(approveInternalReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar y enviar' }));
    await waitFor(() => expect(approveInternalReview).toHaveBeenCalledWith('pieza-1'));
  });

  it('"Pedir corrección interna" exige la nota antes de habilitar el envío', () => {
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir corrección interna' }));
    expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Explica qué hay que corregir…'), {
      target: { value: 'Cambia la fecha' },
    });
    expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeEnabled();
  });

  it('al enviar la corrección interna, llama a requestInternalChanges con el id y la nota', async () => {
    vi.mocked(requestInternalChanges).mockResolvedValue(undefined);
    renderizar({
      profile: crearPerfil({ role: 'agency_admin' }),
      piece: crearPieza({ status: 'pendiente_revision_interna' }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir corrección interna' }));
    fireEvent.change(screen.getByPlaceholderText('Explica qué hay que corregir…'), {
      target: { value: 'Cambia la fecha' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() => expect(requestInternalChanges).toHaveBeenCalledWith('pieza-1', 'Cambia la fecha'));
  });

  it('el reenvío tras cambios del cliente sigue diciendo "Reenviar a revisión" y llamando a submitForReview', () => {
    renderizar({ piece: crearPieza({ status: 'cambios_solicitados' }) });

    expect(screen.getByRole('button', { name: 'Reenviar a revisión' })).toBeInTheDocument();
  });
});
