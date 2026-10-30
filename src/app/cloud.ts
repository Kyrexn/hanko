import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SealedBlobV2 } from '../core/types';

// Servidor de sincronização (Supabase, plano gratuito). Só recebe o cofre e os anexos JÁ CIFRADOS.
// Endereço e chave pública do projeto vêm do arquivo .env.local (não são segredos).
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const cloudConfigured = !!(URL && KEY);

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!cloudConfigured) throw new Error('Sincronização não configurada');
  if (!client) {
    client = createClient(URL!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'cofre-conta' }
    });
  }
  return client;
}

export class ConflictError extends Error {}

function friendly(e: { message?: string } | null): Error {
  const m = e?.message || 'Erro desconhecido';
  if (/invalid login credentials/i.test(m)) return new Error('E-mail ou senha mestra incorretos.');
  if (/email not confirmed/i.test(m)) return new Error('Confirme o e-mail que o Supabase enviou e tente de novo.');
  if (/already registered|already exists/i.test(m)) return new Error('Já existe uma conta com este e-mail. Use “entrar em conta existente”.');
  if (/failed to fetch|network/i.test(m)) return new Error('Sem conexão com o servidor.');
  if (/rate limit|too many/i.test(m)) return new Error('Muitas tentativas seguidas. Espere alguns minutos e tente de novo.');
  if (/aal2|assurance/i.test(m)) return new Error('Esta conta exige o código 2FA.');
  return new Error(m);
}

function friendlyCode(e: { message?: string } | null): Error {
  const m = e?.message || '';
  if (/expired|invalid|otp|code|token/i.test(m)) return new Error('Código inválido ou expirado. Confira e tente de novo.');
  return friendly(e);
}

export const cloud = {
  async session() {
    if (!cloudConfigured) return null;
    const { data } = await sb().auth.getSession();
    return data.session;
  },

  /** Cria a conta. Retorna `false` se o Supabase exigir confirmação por e-mail antes de entrar. */
  async signUp(email: string, secret: string, name = ''): Promise<boolean> {
    const { data, error } = await sb().auth.signUp({ email: email.trim(), password: secret, options: { data: name ? { name } : {} } });
    if (error) throw friendly(error);
    if (data.user && data.user.identities && data.user.identities.length === 0) throw friendly({ message: 'already registered' });
    return !!data.session;
  },

  async signIn(email: string, secret: string) {
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password: secret });
    if (error) throw friendly(error);
  },

  /** Confirma o e-mail com o código de 6 dígitos enviado pelo Supabase. */
  async verifySignup(email: string, code: string) {
    let { error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (error) ({ error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' }));
    if (error) throw friendlyCode(error);
  },

  async resendSignup(email: string) {
    const { error } = await sb().auth.resend({ type: 'signup', email: email.trim() });
    if (error) throw friendly(error);
  },

  /** Envia o código de recuperação de acesso para o e-mail. */
  async requestRecovery(email: string) {
    const { error } = await sb().auth.resetPasswordForEmail(email.trim());
    if (error) throw friendly(error);
  },

  async verifyRecovery(email: string, code: string) {
    const { error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' });
    if (error) throw friendlyCode(error);
  },

  async user() {
    if (!cloudConfigured) return null;
    const { data } = await sb().auth.getUser();
    return data.user;
  },

  /* ---------- 2FA da conta (TOTP do Supabase) ---------- */

  /** A sessão atual ainda precisa do código 2FA para chegar ao nível exigido? */
  async needsMfa(): Promise<boolean> {
    const { data } = await sb().auth.mfa.getAuthenticatorAssuranceLevel();
    return !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
  },

  async mfaFactor() {
    const { data } = await sb().auth.mfa.listFactors();
    return data?.totp?.find(f => f.status === 'verified') || null;
  },

  async verifyMfa(code: string) {
    const f = await this.mfaFactor();
    if (!f) throw new Error('Nenhum 2FA ativo nesta conta.');
    const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: f.id, code: code.trim() });
    if (error) throw friendlyCode(error);
  },

  /** Começa a ativar o 2FA: devolve QR code (imagem), chave e link otpauth para o app autenticador. */
  async enrollMfa() {
    const { data: list } = await sb().auth.mfa.listFactors();
    for (const f of list?.all || []) if (f.status !== 'verified') await sb().auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Hanko' });
    if (error) throw friendly(error);
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
  },

  async confirmEnroll(factorId: string, code: string) {
    const { error } = await sb().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) throw friendlyCode(error);
  },

  async disableMfa() {
    const f = await this.mfaFactor();
    if (!f) return;
    const { error } = await sb().auth.mfa.unenroll({ factorId: f.id });
    if (error) throw friendly(error);
  },

  async signOut() {
    if (cloudConfigured) await sb().auth.signOut();
  },

  async changeSecret(secret: string) {
    const { error } = await sb().auth.updateUser({ password: secret });
    if (error) throw friendly(error);
  },

  async pull(): Promise<{ blob: SealedBlobV2; version: number } | null> {
    const { data, error } = await sb().from('vaults').select('blob, version').maybeSingle();
    if (error) throw friendly(error);
    return data ? { blob: data.blob as SealedBlobV2, version: Number(data.version) } : null;
  },

  /** Grava só se ninguém gravou desde `expected` (senão lança ConflictError). Retorna a versão nova. */
  async push(blob: SealedBlobV2, expected: number): Promise<number> {
    const { data, error } = await sb().rpc('push_vault', { p_blob: blob, p_expected: expected });
    if (error) {
      if (/conflict/i.test(error.message) || error.code === '40001') throw new ConflictError('conflito');
      throw friendly(error);
    }
    return Number(data);
  },

  async listFiles(): Promise<Set<string>> {
    const uid = (await this.session())?.user.id;
    if (!uid) return new Set();
    const out = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb().storage.from('files').list(uid, { limit: 1000, offset });
      if (error) throw friendly(error);
      data.forEach(f => out.add(f.name));
      if (data.length < 1000) return out;
    }
  },

  /** Anexo cifrado: 12 bytes de IV + texto cifrado. */
  async uploadFile(id: string, iv: Uint8Array, ct: Uint8Array) {
    const uid = (await this.session())?.user.id;
    if (!uid) throw new Error('Sem sessão');
    const body = new Uint8Array(iv.length + ct.length);
    body.set(iv); body.set(ct, iv.length);
    const { error } = await sb().storage.from('files').upload(`${uid}/${id}`, new Blob([body]), { upsert: true, contentType: 'application/octet-stream' });
    if (error) throw friendly(error);
  },

  async downloadFile(id: string): Promise<{ iv: Uint8Array<ArrayBuffer>; ct: Uint8Array<ArrayBuffer> } | null> {
    const uid = (await this.session())?.user.id;
    if (!uid) return null;
    const { data, error } = await sb().storage.from('files').download(`${uid}/${id}`);
    if (error || !data) return null;
    const all = new Uint8Array(await data.arrayBuffer());
    return { iv: all.slice(0, 12), ct: all.slice(12) };
  },

  /** Exclui a conta: primeiro os anexos (API de Storage), depois cofre e usuário (função no banco). */
  async deleteAccount() {
    const uid = (await this.session())?.user.id;
    if (!uid) throw new Error('Sem sessão. Entre na conta de novo.');
    const ids = [...await this.listFiles()];
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await sb().storage.from('files').remove(ids.slice(i, i + 100).map(id => `${uid}/${id}`));
      if (error) throw friendly(error);
    }
    const { error } = await sb().rpc('delete_my_account');
    if (error) throw friendly(error);
    await sb().auth.signOut().catch(() => {});
  },

  async removeFile(id: string) {
    const uid = (await this.session())?.user.id;
    if (uid) await sb().storage.from('files').remove([`${uid}/${id}`]);
  }
};
