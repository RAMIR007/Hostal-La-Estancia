-- Editable public site data, editor roles, and public photo storage.

create table public.site_content (
  id boolean primary key default true check (id),
  hero_title text default 'La ciudad se vive mejor desde casa.',
  hero_intro text default 'Un lugar para hacer una pausa, sentir el ritmo de La Habana y descubrir sus historias con una mirada local.',
  hero_note text default 'Tu punto de partida para conocer la ciudad.',
  intro_title text default 'Qué bueno que llegaste.',
  intro_paragraph_1 text default 'Hostal La Estancia es una invitación a conocer La Habana sin apuros: disfrutar de un espacio acogedor y encontrar nuevas formas de conectar con la ciudad.',
  intro_paragraph_2 text default 'Ya sea tu primera visita o una vuelta esperada, aquí empieza una experiencia hecha a tu ritmo.',
  experience_title text default 'La Habana, a tu ritmo.',
  experience_intro text default 'Hay muchas formas de conocerla. Elige por dónde empezar.',
  guide_title text default 'Historias en cada esquina',
  guide_description text default 'Recorre la ciudad con una guía local y descubre sus rincones, su historia y su vida cotidiana.',
  local_title text default 'La ciudad como un local',
  local_description text default '¿Buscas recomendaciones para tu visita? Te ayudamos a encontrar tu propio ritmo en La Habana.',
  stay_title text default 'Un lugar donde volver',
  stay_description text default 'Haz de La Estancia tu punto de partida para descansar y planear cada día a tu manera.',
  contact_title text default '¿Ya te imaginas por aquí?',
  contact_intro text default 'Cuéntanos qué tienes en mente: una estancia, un recorrido o simplemente ganas de conocer La Habana.',
  whatsapp text default null,
  email text default null,
  address text default 'La Habana, Cuba',
  hero_image_url text default null,
  room_image_url text default null,
  experience_image_url text default null,
  updated_at timestamptz not null default now()
);

insert into public.site_content (id) values (true)
on conflict (id) do nothing;

create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'pending' check (role in ('admin', 'owner', 'pending')),
  created_at timestamptz not null default now()
);

alter table public.site_content enable row level security;
alter table public.user_profiles enable row level security;

-- This helper is evaluated as its owner so profile RLS does not recurse.
create or replace function public.is_site_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.role in ('admin', 'owner')
  );
$$;

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.role = 'admin'
  );
$$;

revoke all on function public.is_site_editor() from public, anon, authenticated;
revoke all on function public.is_site_admin() from public, anon, authenticated;
grant execute on function public.is_site_editor() to authenticated;
grant execute on function public.is_site_admin() to authenticated;

create policy "Site content is publicly readable"
  on public.site_content for select
  to anon, authenticated
  using (true);

create policy "Editors can update site content"
  on public.site_content for update
  to authenticated
  using ((select public.is_site_editor()))
  with check ((select public.is_site_editor()));

create policy "Users can read their own profile and admins can list profiles"
  on public.user_profiles for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_site_admin()));

revoke all on public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant update on public.site_content to authenticated;

revoke all on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;

-- New Auth accounts remain pending unless an administrator explicitly invites them.
-- Auth email changes are mirrored without changing an existing role.
create or replace function public.sync_user_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, email, role)
  values (new.id, new.email, 'pending')
  on conflict (user_id) do update
  set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.sync_user_profile_from_auth() from public, anon, authenticated;

create trigger on_auth_user_created_sync_profile
  after insert on auth.users
  for each row execute function public.sync_user_profile_from_auth();

create trigger on_auth_user_email_changed_sync_profile
  after update of email on auth.users
  for each row execute function public.sync_user_profile_from_auth();

create or replace function public.set_site_content_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_site_content_updated_at() from public, anon, authenticated;

create trigger set_site_content_updated_at
  before update on public.site_content
  for each row execute function public.set_site_content_updated_at();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'hostal-media',
  'hostal-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Hostal photos are publicly readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'hostal-media');

create policy "Editors can upload hostal photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'hostal-media'
    and (select public.is_site_editor())
  );

create policy "Editors can update hostal photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'hostal-media'
    and (select public.is_site_editor())
  )
  with check (
    bucket_id = 'hostal-media'
    and (select public.is_site_editor())
  );

create policy "Editors can delete hostal photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'hostal-media'
    and (select public.is_site_editor())
  );

-- Bootstrap the first administrator only through the trusted SQL editor, after creating
-- their Auth user: update public.user_profiles set role = 'admin' where user_id = '<auth-user-uuid>';
