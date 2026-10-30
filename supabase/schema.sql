-- Cofre — estrutura do servidor de sincronização (Supabase, plano gratuito).
-- O servidor guarda APENAS dados cifrados no aparelho; ele nunca vê senhas nem a senha mestra.
-- Rode este arquivo inteiro uma vez em: Supabase → SQL Editor → New query → Run.

-- 1) Um cofre cifrado por conta.
create table if not exists public.vaults (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  blob       jsonb       not null,
  version    bigint      not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.vaults enable row level security;

drop policy if exists "cofre: ler o proprio" on public.vaults;
create policy "cofre: ler o proprio" on public.vaults
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "cofre: criar o proprio" on public.vaults;
create policy "cofre: criar o proprio" on public.vaults
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "cofre: alterar o proprio" on public.vaults;
create policy "cofre: alterar o proprio" on public.vaults
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 2) Gravação com controle de versão: só grava se ninguém gravou no meio (evita perder edições).
create or replace function public.push_vault(p_blob jsonb, p_expected bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.vaults as t (user_id, blob, version, updated_at)
  values (auth.uid(), p_blob, 1, now())
  on conflict (user_id) do update
    set blob = excluded.blob, version = t.version + 1, updated_at = now()
    where t.version = p_expected
  returning t.version into v;

  if v is null then
    raise exception 'conflict' using errcode = '40001';
  end if;
  return v;
end;
$$;

revoke all on function public.push_vault(jsonb, bigint) from public, anon;
grant execute on function public.push_vault(jsonb, bigint) to authenticated;

-- 3) Anexos cifrados (PDFs de recuperação etc.) num bucket privado, uma pasta por conta.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "anexos: ler os proprios" on storage.objects;
create policy "anexos: ler os proprios" on storage.objects
  for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "anexos: enviar os proprios" on storage.objects;
create policy "anexos: enviar os proprios" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "anexos: substituir os proprios" on storage.objects;
create policy "anexos: substituir os proprios" on storage.objects
  for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 4) Updates: área pública só de leitura com instaladores e manifestos de versão.
--    Só contas listadas em private.publishers (fora da API) podem publicar.
insert into storage.buckets (id, name, public, file_size_limit)
values ('updates', 'updates', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.publishers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
revoke all on private.publishers from public, anon, authenticated;

create or replace function private.is_publisher()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.publishers p where p.user_id = auth.uid()); $$;
revoke all on function private.is_publisher() from public, anon;
grant execute on function private.is_publisher() to authenticated;

drop policy if exists "updates: publicar" on storage.objects;
create policy "updates: publicar" on storage.objects for insert to authenticated
  with check (bucket_id = 'updates' and (select private.is_publisher()));
drop policy if exists "updates: substituir" on storage.objects;
create policy "updates: substituir" on storage.objects for update to authenticated
  using (bucket_id = 'updates' and (select private.is_publisher()))
  with check (bucket_id = 'updates' and (select private.is_publisher()));
drop policy if exists "updates: apagar" on storage.objects;
create policy "updates: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'updates' and (select private.is_publisher()));
drop policy if exists "updates: ler para publicar" on storage.objects;
create policy "updates: ler para publicar" on storage.objects for select to authenticated
  using (bucket_id = 'updates' and (select private.is_publisher()));

-- 5) 2FA da conta: com fator TOTP verificado, só sessões aal2 acessam cofre e anexos.
--    (aplicado como migração "cofre_require_mfa": as políticas de vaults e de files incluem `and (select private.mfa_ok())`)
create or replace function private.mfa_ok()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function private.mfa_ok() from public, anon;
grant execute on function private.mfa_ok() to authenticated;

-- Para autorizar a sua conta a publicar (rode uma vez, trocando o e-mail):
-- insert into private.publishers (user_id) select id from auth.users where email = 'voce@exemplo.com';

drop policy if exists "anexos: apagar os proprios" on storage.objects;
create policy "anexos: apagar os proprios" on storage.objects
  for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 6) Excluir a própria conta pelo app (migração "hanko_delete_my_account").
--    O app apaga antes os anexos pela API de Storage; aqui some o cofre cifrado e o usuário.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not private.mfa_ok() then raise exception 'aal2 required'; end if;
  delete from public.vaults where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
