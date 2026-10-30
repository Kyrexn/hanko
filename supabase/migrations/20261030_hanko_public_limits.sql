-- Limites para uso público (anti-abuso), sem afetar uso normal:
-- • cofre cifrado de até 20 MB por conta (milhares de senhas cabem em menos de 1 MB);
-- • o servidor só aceita blobs com a forma de um cofre cifrado do Hanko;
-- • até 300 anexos por conta (cada um já é limitado a 25 MB pelo bucket).

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
  if octet_length(p_blob::text) > 20 * 1024 * 1024 then
    raise exception 'cofre grande demais (limite de 20 MB)' using errcode = '54000';
  end if;
  if p_blob ->> 'app' is distinct from 'cofre' or (p_blob ->> 'ct') is null or (p_blob ->> 'iv') is null then
    raise exception 'formato inválido' using errcode = '22023';
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

create or replace function private.file_count_ok()
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) < 300 from storage.objects o
  where o.bucket_id = 'files' and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;
revoke all on function private.file_count_ok() from public, anon;
grant execute on function private.file_count_ok() to authenticated;

drop policy if exists "anexos: enviar os proprios" on storage.objects;
create policy "anexos: enviar os proprios" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.mfa_ok())
    and (select private.file_count_ok())
  );
