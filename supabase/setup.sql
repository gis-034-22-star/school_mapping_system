-- =====================================================
-- Lilongwe School Mapping System : Supabase setup
-- Run in Supabase > SQL Editor > New query > Run.
-- STEP 1: change the e-mail address in the last INSERT
--         to the e-mail of your administrator account.
-- =====================================================

-- 1) Schools table
create table if not exists public.schools (
    id         bigint generated always as identity primary key,
    name       text not null check (length(trim(name)) > 0),
    level      text not null check (level in ('Primary School', 'Secondary School')),
    ownership  text not null check (ownership in ('Public', 'Private')),
    type       text,
    latitude   double precision not null check (latitude  between -90  and 90),
    longitude  double precision not null check (longitude between -180 and 180),
    image      text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists schools_set_updated_at on public.schools;
create trigger schools_set_updated_at
before update on public.schools
for each row execute function public.set_updated_at();

-- 2) List of administrators (by e-mail)
create table if not exists public.admins (
    email text primary key
);
alter table public.admins enable row level security;   -- no policies: nobody can read it directly

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.admins
        where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

-- 3) Row Level Security: everyone can READ, only admins can WRITE
alter table public.schools enable row level security;

drop policy if exists "Anyone can read schools" on public.schools;
create policy "Anyone can read schools"
    on public.schools for select
    to anon, authenticated
    using (true);

drop policy if exists "Admins can add schools" on public.schools;
create policy "Admins can add schools"
    on public.schools for insert
    to authenticated
    with check (public.is_admin());

drop policy if exists "Admins can update schools" on public.schools;
create policy "Admins can update schools"
    on public.schools for update
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "Admins can delete schools" on public.schools;
create policy "Admins can delete schools"
    on public.schools for delete
    to authenticated
    using (public.is_admin());

-- 4) Make your administrator (use the SAME e-mail as the user you create in Authentication > Users)
insert into public.admins (email)
values ('your-admin-email@example.com')
on conflict do nothing;
