-- Okpotani General Hardware: secure shared-workspace schema for Supabase.
-- Run this entire file in Supabase Dashboard -> SQL Editor -> New query.
-- The app uses only the project's publishable/anon key. Do not expose service_role keys.

create extension if not exists pgcrypto;

create table if not exists public.okpotani_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8),'hex'),1,10)),
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.okpotani_members (
  workspace_id uuid not null references public.okpotani_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

create index if not exists okpotani_members_user_idx on public.okpotani_members(user_id);
alter table public.okpotani_workspaces enable row level security;
alter table public.okpotani_members enable row level security;

drop policy if exists "Members can read their workspace" on public.okpotani_workspaces;
create policy "Members can read their workspace" on public.okpotani_workspaces
  for select to authenticated using (
    exists (select 1 from public.okpotani_members m where m.workspace_id=id and m.user_id=auth.uid())
  );
drop policy if exists "Users can read their own membership" on public.okpotani_members;
create policy "Users can read their own membership" on public.okpotani_members
  for select to authenticated using (user_id=auth.uid());

grant select on public.okpotani_workspaces, public.okpotani_members to authenticated;

create or replace function public.okp_create_workspace(p_name text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_id uuid; v_code text; v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists(select 1 from public.okpotani_members where user_id=auth.uid()) then raise exception 'This account already belongs to a workspace'; end if;
  v_name := coalesce(nullif(trim(p_name),''),'Okpotani General Hardware');
  v_code := upper(substr(encode(gen_random_bytes(8),'hex'),1,10));
  insert into public.okpotani_workspaces(name,owner_id,invite_code,data) values(v_name,auth.uid(),v_code,coalesce(p_data,'{}'::jsonb)) returning id into v_id;
  insert into public.okpotani_members(workspace_id,user_id,role) values(v_id,auth.uid(),'owner');
  return jsonb_build_object('workspace_id',v_id,'workspace_name',v_name,'role','owner','invite_code',v_code,'revision',1,'data',coalesce(p_data,'{}'::jsonb),'updated_at',now());
end; $$;

create or replace function public.okp_join_workspace(p_invite_code text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists(select 1 from public.okpotani_members where user_id=auth.uid()) then raise exception 'This account already belongs to a workspace'; end if;
  select id into v_id from public.okpotani_workspaces where invite_code=upper(trim(p_invite_code));
  if v_id is null then raise exception 'Invite code not found'; end if;
  insert into public.okpotani_members(workspace_id,user_id,role) values(v_id,auth.uid(),'staff');
  return jsonb_build_object('workspace_id',v_id,'joined',true);
end; $$;

create or replace function public.okp_get_workspace()
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select w.id,w.name,w.invite_code,w.data,w.revision,w.updated_at,m.role
    into r from public.okpotani_workspaces w join public.okpotani_members m on m.workspace_id=w.id
    where m.user_id=auth.uid() order by (m.role='owner') desc,w.updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('workspace_id',r.id,'workspace_name',r.name,'invite_code',case when r.role='owner' then r.invite_code else null end,'data',r.data,'revision',r.revision,'updated_at',r.updated_at,'role',r.role);
end; $$;

create or replace function public.okp_save_workspace(p_workspace_id uuid,p_data jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_revision bigint; v_updated timestamptz; v_current bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists(select 1 from public.okpotani_members where workspace_id=p_workspace_id and user_id=auth.uid()) then raise exception 'You are not a member of this workspace'; end if;
  update public.okpotani_workspaces set data=coalesce(p_data,'{}'::jsonb),revision=revision+1,updated_at=now()
    where id=p_workspace_id and revision=p_expected_revision returning revision,updated_at into v_revision,v_updated;
  if not found then
    select revision into v_current from public.okpotani_workspaces where id=p_workspace_id;
    raise exception 'SYNC_CONFLICT: expected revision %, current revision %',p_expected_revision,coalesce(v_current,-1);
  end if;
  return jsonb_build_object('revision',v_revision,'updated_at',v_updated);
end; $$;

revoke all on function public.okp_create_workspace(text,jsonb) from public;
revoke all on function public.okp_join_workspace(text) from public;
revoke all on function public.okp_get_workspace() from public;
revoke all on function public.okp_save_workspace(uuid,jsonb,bigint) from public;
grant execute on function public.okp_create_workspace(text,jsonb) to authenticated;
grant execute on function public.okp_join_workspace(text) to authenticated;
grant execute on function public.okp_get_workspace() to authenticated;
grant execute on function public.okp_save_workspace(uuid,jsonb,bigint) to authenticated;
