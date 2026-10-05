-- 0015: slug legible por marca para el enlace compartible de la grilla (/grilla/<slug>/<anio>/<mes>).
--
-- El slug sale del nombre de la marca ("Café Lúcuma" -> "cafe-lucuma") y se genera en la base, en
-- un trigger, así que ni la app ni los formularios necesitan permisos nuevos para escribirlo: el
-- trigger corre como quien inserta, pero la columna nunca se nombra en un INSERT o UPDATE desde el
-- cliente. Se fija al crear la marca y no cambia después: renombrar la marca no debe romper un
-- enlace que ya le mandaron a un cliente.
--
-- Si dos marcas se llaman igual, la segunda recibe "-2", la tercera "-3", etc. El índice único
-- garantiza que nunca haya dos iguales aunque dos altas corran a la vez.

alter table public.clients add column if not exists slug text;

-- Solo letras sin acento, cifras y guiones. Sin nombre usable, cae a "marca".
create or replace function public.slugify_marca(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(
        translate(lower(coalesce(p_texto, '')), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
        '[^a-z0-9]+', '-', 'g'
      )),
      ''
    ),
    'marca'
  );
$$;

-- Security definer: al insertar, el trigger debe ver los slugs de TODAS las agencias para no
-- repetir uno, aunque la RLS del usuario que inserta no le deje ver las marcas ajenas.
create or replace function public.slug_unico_de_marca(p_brand text, p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := public.slugify_marca(p_brand);
  candidato text := base;
  n int := 2;
begin
  while exists (select 1 from public.clients where slug = candidato and id <> p_id) loop
    candidato := base || '-' || n;
    n := n + 1;
  end loop;
  return candidato;
end;
$$;

create or replace function public.asignar_slug_de_marca()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null then
    new.slug := public.slug_unico_de_marca(new.brand_name, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists asignar_slug_de_marca on public.clients;
create trigger asignar_slug_de_marca
  before insert or update on public.clients
  for each row execute function public.asignar_slug_de_marca();

-- Marcas que ya existían: se asigna en orden de creación, así el más antiguo conserva el nombre limpio.
do $$
declare
  r record;
begin
  for r in select id, brand_name from public.clients where slug is null order by created_at, id loop
    update public.clients set slug = public.slug_unico_de_marca(r.brand_name, r.id) where id = r.id;
  end loop;
end;
$$;

alter table public.clients alter column slug set not null;
create unique index if not exists clients_slug_key on public.clients (slug);

-- La columna es nueva: sin este grant, la app no podría leerla (ver el bloque de privilegios de
-- columna de 0010). No se concede escritura: el slug lo fija solo el trigger.
grant select (slug) on public.clients to authenticated;
