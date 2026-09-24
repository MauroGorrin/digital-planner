'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Client, Profile } from '@/types/database';
import { useConfirm } from './ConfirmDialog';
import {
  assignTeamMember,
  inviteUser,
  removeClientContact,
  removeTeamAssignment,
  updateClientEntity,
  updateNotificationSettings,
  setClientCalendarMapping,
  removeClientCalendarMapping,
} from '@/app/admin-actions';

interface LinkedProfile {
  profile_id: string;
  profiles: { id: string; full_name: string; email: string } | null;
}

export function ClientDetail({
  profile,
  client,
  assignments,
  contacts,
  team,
  notificationSettings,
  calendarMapping,
  connections,
}: {
  profile: Profile;
  client: Client;
  assignments: LinkedProfile[];
  contacts: LinkedProfile[];
  team: Profile[];
  notificationSettings: { email_on_pending_review: boolean; email_on_client_response: boolean; reminder_after_days: number } | null;
  calendarMapping: { connection_id: string } | null;
  connections: { id: string; label: string; calendar_id: string }[];
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [teamPick, setTeamPick] = useState(team[0]?.id ?? '');

  const [emailPending, setEmailPending] = useState(notificationSettings?.email_on_pending_review ?? true);
  const [emailResponse, setEmailResponse] = useState(notificationSettings?.email_on_client_response ?? true);
  const [reminderDays, setReminderDays] = useState(notificationSettings?.reminder_after_days ?? 2);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ocurrió un error.');
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {dialog}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/clientes" className="hover:underline">
          Clientes
        </Link>
        <span>/</span>
        <span className="text-slate-700">{client.brand_name}</span>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{client.brand_name}</h1>
            <p className="text-sm text-slate-500">
              {client.name} · {client.timezone}
            </p>
          </div>
          <button
            onClick={() =>
              confirm({
                title: client.archived ? 'Reactivar cliente' : 'Archivar cliente',
                description: client.archived
                  ? 'El cliente volverá a aparecer en el calendario y listados.'
                  : 'El cliente dejará de aparecer en listados activos. No se elimina información.',
                confirmLabel: client.archived ? 'Reactivar' : 'Archivar',
                onConfirm: () => run(() => updateClientEntity(client.id, { archived: !client.archived })),
              })
            }
            className="btn-secondary"
          >
            {client.archived ? 'Reactivar' : 'Archivar'}
          </button>
        </div>
        {client.notes && <p className="mt-3 text-sm text-slate-600">{client.notes}</p>}
        <Link href={`/calendario?client=${client.id}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Ver calendario de este cliente →
        </Link>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Equipo de agencia asignado</h2>
        <ul className="mb-3 space-y-1.5">
          {assignments.length === 0 && <p className="text-sm text-slate-400">Nadie asignado todavía.</p>}
          {assignments.map((a) => (
            <li key={a.profile_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span>{a.profiles?.full_name ?? a.profile_id}</span>
              <button onClick={() => run(() => removeTeamAssignment(client.id, a.profile_id))} className="text-xs text-red-500 hover:underline">
                Quitar
              </button>
            </li>
          ))}
        </ul>
        {team.length > 0 ? (
          <div className="flex gap-2">
            <select value={teamPick} onChange={(e) => setTeamPick(e.target.value)} className="filter-select flex-1">
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
            <button onClick={() => run(() => assignTeamMember(client.id, teamPick))} className="btn-secondary">
              Asignar
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Invita miembros del equipo desde Ajustes.</p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Contactos del cliente</h2>
        <ul className="mb-3 space-y-1.5">
          {contacts.length === 0 && <p className="text-sm text-slate-400">Sin contactos invitados todavía.</p>}
          {contacts.map((c) => (
            <li key={c.profile_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span>
                {c.profiles?.full_name} <span className="text-slate-400">· {c.profiles?.email}</span>
              </span>
              <button onClick={() => run(() => removeClientContact(client.id, c.profile_id))} className="text-xs text-red-500 hover:underline">
                Quitar
              </button>
            </li>
          ))}
        </ul>
        {profile.role === 'agency_admin' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await inviteUser({ email: contactEmail, full_name: contactName, role: 'client', client_id: client.id });
                setContactEmail('');
                setContactName('');
              });
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              required
              placeholder="Nombre completo"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="email"
              placeholder="correo@cliente.com"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={isPending} className="btn-primary whitespace-nowrap">
              Invitar contacto
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-400">Solo un administrador puede invitar contactos.</p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Notificaciones automáticas</h2>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={emailPending} onChange={(e) => setEmailPending(e.target.checked)} />
            Enviar correo al cliente cuando haya contenido pendiente de revisión
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={emailResponse} onChange={(e) => setEmailResponse(e.target.checked)} />
            Enviar correo al equipo cuando el cliente apruebe o solicite cambios
          </label>
          <label className="flex items-center gap-2">
            Recordar revisión pendiente después de
            <input
              type="number"
              min={1}
              max={30}
              value={reminderDays}
              onChange={(e) => setReminderDays(Number(e.target.value))}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            días
          </label>
        </div>
        <button
          onClick={() =>
            run(() =>
              updateNotificationSettings(client.id, {
                email_on_pending_review: emailPending,
                email_on_client_response: emailResponse,
                reminder_after_days: reminderDays,
              })
            )
          }
          className="btn-primary mt-3"
        >
          Guardar notificaciones
        </button>
      </div>

      {profile.role === 'agency_admin' && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Google Calendar</h2>
          <p className="mb-3 text-xs text-slate-500">Elige qué calendario conectado se usa para las publicaciones aprobadas/programadas de este cliente.</p>
          {connections.length === 0 ? (
            <p className="text-sm text-slate-400">
              Aún no hay calendarios conectados.{' '}
              <Link href="/ajustes" className="text-brand-600 hover:underline">
                Conecta uno en Ajustes
              </Link>
              .
            </p>
          ) : (
            <div className="flex gap-2">
              <select
                defaultValue={calendarMapping?.connection_id ?? ''}
                onChange={(e) => e.target.value && run(() => setClientCalendarMapping(client.id, e.target.value))}
                className="filter-select flex-1"
              >
                <option value="" disabled>
                  Selecciona un calendario
                </option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {calendarMapping && (
                <button onClick={() => run(() => removeClientCalendarMapping(client.id))} className="btn-secondary">
                  Quitar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
