-- =====================================================
-- SCHOOL REGISTRATIONS AND UPDATES
-- Run ONCE in Supabase > SQL Editor > New query > Run
-- (after setup.sql and seed.sql have been run).
--
-- What it adds:
--   * city_boundary      : the Lilongwe City boundary used to verify locations
--   * school_submissions : new schools / updates sent by registered users
--   * a private storage bucket "school-evidence" for supporting documents
--   * automatic checks (coordinates, inside the city, duplicate location, evidence)
--   * review_submission(): education officers (the admins) approve or reject
-- Nothing reaches the public map until an education officer approves it.
-- =====================================================


-- 1) City boundary (one row). Replace the polygon with the official boundary when you have it:
--      update public.city_boundary set geojson = '{"type":"Polygon","coordinates":[[[lng,lat],...]]}'::jsonb where id = 1;
create table if not exists public.city_boundary (
    id         int primary key default 1 check (id = 1),
    name       text not null,
    geojson    jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.city_boundary enable row level security;

drop policy if exists "Anyone can read the boundary" on public.city_boundary;
create policy "Anyone can read the boundary"
    on public.city_boundary for select
    to anon, authenticated
    using (true);

insert into public.city_boundary (id, name, geojson)
values (
    1,
    'Lilongwe City (approximate working boundary)',
    '{"type":"Polygon","coordinates":[[[33.66236,-14.03391],[33.68534,-14.05503],[33.81305,-14.05037],[33.82666,-14.02038],[33.85346,-13.95929],[33.81674,-13.76145],[33.80888,-13.74857],[33.7393,-13.78877],[33.66236,-14.03391]]]}'::jsonb
)
on conflict (id) do nothing;


-- 2) Helper functions
create or replace function public.km_between(
    lat1 double precision, lng1 double precision,
    lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
    select 2 * 6371 * asin(sqrt(least(1,
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    )));
$$;

create or replace function public.in_city(p_lat double precision, p_lng double precision)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    ring   jsonb;
    n      int;
    i      int;
    j      int;
    xi     double precision;
    yi     double precision;
    xj     double precision;
    yj     double precision;
    inside boolean := false;
begin
    select geojson -> 'coordinates' -> 0 into ring from public.city_boundary where id = 1;
    if ring is null then
        raise exception 'The Lilongwe City boundary has not been set up.';
    end if;

    n := jsonb_array_length(ring);
    j := n - 1;
    for i in 0 .. n - 1 loop
        xi := (ring -> i ->> 0)::double precision;
        yi := (ring -> i ->> 1)::double precision;
        xj := (ring -> j ->> 0)::double precision;
        yj := (ring -> j ->> 1)::double precision;
        if ((yi > p_lat) <> (yj > p_lat))
           and (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
            inside := not inside;
        end if;
        j := i;
    end loop;

    return inside;
end $$;


-- 3) Submissions table
create table if not exists public.school_submissions (
    id                 uuid primary key default gen_random_uuid(),
    kind               text not null check (kind in ('new', 'update')),
    target_school_id   bigint references public.schools(id) on delete set null,
    name               text not null,
    level              text not null check (level in ('Primary School', 'Secondary School')),
    ownership          text not null check (ownership in ('Public', 'Private')),
    type               text,
    latitude           double precision not null,
    longitude          double precision not null,
    location_method    text check (location_method in ('gps', 'map', 'typed')),
    gps_accuracy_m     double precision,
    notes              text,
    evidence           jsonb not null default '[]'::jsonb,
    status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    submitted_by       uuid not null default auth.uid(),
    submitter_email    text,
    submitter_name     text,
    reviewed_by        text,
    review_note        text,
    reviewed_at        timestamptz,
    approved_school_id bigint,
    created_at         timestamptz not null default now()
);

create index if not exists school_submissions_status_idx on public.school_submissions (status, created_at desc);
create index if not exists school_submissions_user_idx   on public.school_submissions (submitted_by);


-- 4) Automatic checks when a user submits
create or replace function public.validate_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    uid       uuid := auth.uid();
    dup       record;
    pend      record;
    ev        jsonb;
    pending_n int;
begin
    if uid is null then
        raise exception 'Please sign in before submitting.';
    end if;

    /* the server decides who submitted it and that it starts as pending */
    new.submitted_by    := uid;
    new.submitter_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    new.submitter_name  := nullif(trim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')), '');
    new.status          := 'pending';
    new.reviewed_by     := null;
    new.review_note     := null;
    new.reviewed_at     := null;
    new.approved_school_id := null;

    new.name := trim(coalesce(new.name, ''));
    if new.name = '' then
        raise exception 'School name is required.';
    end if;

    if new.latitude is null or new.longitude is null
       or new.latitude not between -90 and 90 or new.longitude not between -180 and 180 then
        raise exception 'The coordinates are not valid (latitude -90 to 90, longitude -180 to 180).';
    end if;

    /* must be inside Lilongwe City */
    if not public.in_city(new.latitude, new.longitude) then
        raise exception 'This location is outside the Lilongwe City boundary. Only schools inside Lilongwe City can be submitted.';
    end if;

    if new.kind = 'update' then
        if new.target_school_id is null
           or not exists (select 1 from public.schools where id = new.target_school_id) then
            raise exception 'Choose an existing school to update.';
        end if;
    else
        new.target_school_id := null;
    end if;

    /* duplicate location: another school within 30 m */
    select s.name, public.km_between(new.latitude, new.longitude, s.latitude, s.longitude) * 1000 as metres
      into dup
      from public.schools s
     where (new.target_school_id is null or s.id <> new.target_school_id)
       and public.km_between(new.latitude, new.longitude, s.latitude, s.longitude) < 0.03
     order by 2
     limit 1;
    if found then
        raise exception 'Duplicate location: "%" is already registered about % m from this point.', dup.name, round(dup.metres::numeric);
    end if;

    /* duplicate of a submission that is still waiting for review */
    select p.name
      into pend
      from public.school_submissions p
     where p.status = 'pending'
       and (new.target_school_id is null or p.target_school_id is distinct from new.target_school_id)
       and public.km_between(new.latitude, new.longitude, p.latitude, p.longitude) < 0.03
     limit 1;
    if found then
        raise exception 'A submission for "%" at this location is already waiting for review.', pend.name;
    end if;

    /* supporting evidence is compulsory */
    if jsonb_typeof(new.evidence) is distinct from 'array'
       or jsonb_array_length(new.evidence) < 1 then
        raise exception 'Upload at least one supporting document (certificate, approval, headteacher letter, photo or proof of establishment).';
    end if;
    if jsonb_array_length(new.evidence) > 8 then
        raise exception 'Too many documents (maximum 8).';
    end if;
    for ev in select * from jsonb_array_elements(new.evidence) loop
        if coalesce(ev ->> 'path', '') not like uid::text || '/%' then
            raise exception 'A supporting document does not belong to your account. Please upload it again.';
        end if;
    end loop;

    /* stop flooding */
    select count(*) into pending_n
      from public.school_submissions
     where submitted_by = uid and status = 'pending';
    if pending_n >= 10 then
        raise exception 'You already have 10 submissions waiting for review. Please wait for the education officers to review them.';
    end if;

    return new;
end $$;

drop trigger if exists school_submissions_validate on public.school_submissions;
create trigger school_submissions_validate
before insert on public.school_submissions
for each row execute function public.validate_submission();


-- 5) Who can see / add submissions (nobody can edit or delete them directly)
alter table public.school_submissions enable row level security;

drop policy if exists "Users see own submissions, officers see all" on public.school_submissions;
create policy "Users see own submissions, officers see all"
    on public.school_submissions for select
    to authenticated
    using (submitted_by = auth.uid() or public.is_admin());

drop policy if exists "Registered users add their own submissions" on public.school_submissions;
create policy "Registered users add their own submissions"
    on public.school_submissions for insert
    to authenticated
    with check (submitted_by = auth.uid());


grant select, insert on public.school_submissions to authenticated;
grant select on public.city_boundary to anon, authenticated;


-- 6) Education officers approve or reject
create or replace function public.review_submission(
    p_id      uuid,
    p_approve boolean,
    p_note    text default null)
returns public.school_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
    sub      public.school_submissions;
    dup      record;
    new_id   bigint;
    reviewer text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    if not public.is_admin() then
        raise exception 'Only education officers can review submissions.' using errcode = '42501';
    end if;

    select * into sub from public.school_submissions where id = p_id for update;
    if not found then
        raise exception 'Submission not found.';
    end if;
    if sub.status <> 'pending' then
        raise exception 'This submission was already %.', sub.status;
    end if;

    if p_approve then
        if sub.kind = 'new' then
            select s.name into dup
              from public.schools s
             where public.km_between(sub.latitude, sub.longitude, s.latitude, s.longitude) < 0.03
             limit 1;
            if found then
                raise exception 'Cannot approve: "%" is already registered at this location.', dup.name;
            end if;

            insert into public.schools (name, level, ownership, type, latitude, longitude)
            values (sub.name, sub.level, sub.ownership, sub.type, sub.latitude, sub.longitude)
            returning id into new_id;
        else
            if sub.target_school_id is null then
                raise exception 'Cannot approve: the school to update no longer exists.';
            end if;
            update public.schools
               set name = sub.name, level = sub.level, ownership = sub.ownership, type = sub.type,
                   latitude = sub.latitude, longitude = sub.longitude
             where id = sub.target_school_id;
            new_id := sub.target_school_id;
        end if;

        update public.school_submissions
           set status = 'approved', reviewed_by = reviewer,
               review_note = nullif(trim(coalesce(p_note, '')), ''),
               reviewed_at = now(), approved_school_id = new_id
         where id = p_id
        returning * into sub;
    else
        if trim(coalesce(p_note, '')) = '' then
            raise exception 'Please give a reason for rejecting this submission.';
        end if;

        update public.school_submissions
           set status = 'rejected', reviewed_by = reviewer,
               review_note = trim(p_note), reviewed_at = now()
         where id = p_id
        returning * into sub;
    end if;

    return sub;
end $$;

revoke all on function public.review_submission(uuid, boolean, text) from public, anon;
grant execute on function public.review_submission(uuid, boolean, text) to authenticated;


-- 7) Private storage for the supporting documents (max 5 MB each: PDF, JPG, PNG, WEBP)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-evidence', 'school-evidence', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own evidence" on storage.objects;
create policy "Users upload own evidence"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'school-evidence' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners and officers read evidence" on storage.objects;
create policy "Owners and officers read evidence"
    on storage.objects for select
    to authenticated
    using (bucket_id = 'school-evidence'
           and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "Users delete own evidence" on storage.objects;
create policy "Users delete own evidence"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'school-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
