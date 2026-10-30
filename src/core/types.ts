export type OtpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface OtpParams {
  secret: string;
  digits: number;
  period: number;
  algorithm: OtpAlgorithm;
  /** 'hotp' = código por contador (alguns bancos e tokens); ausente = TOTP, por tempo. */
  type?: 'totp' | 'hotp';
  /** HOTP: próximo contador a usar (sobe a cada código gerado). */
  counter?: number;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  added: number;
}

export type ItemKind = 'login' | 'card' | 'identity' | 'note';

export interface CardData {
  holder: string;
  number: string;
  brand: string;
  /** MM/AA */
  expiry: string;
  cvv: string;
  pin: string;
}

export interface IdentityData {
  fullName: string;
  cpf: string;
  rg: string;
  birth: string;
  phone: string;
  email: string;
  address: string;
}

/** Campo extra livre (ex.: "pergunta de segurança", "agência"). `hidden` = tratado como segredo. */
export interface CustomField {
  id: string;
  label: string;
  value: string;
  hidden: boolean;
}

export interface PasswordHistoryEntry {
  password: string;
  /** Quando deixou de ser a senha atual. */
  changed: number;
}

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  url: string;
  username: string;
  password: string;
  otp: OtpParams | null;
  notes: string;
  /** Códigos de recuperação em texto, um por linha. */
  recoveryCodes: string;
  folderId: string | null;
  tags: string[];
  favorite: boolean;
  attachments: Attachment[];
  created: number;
  updated: number;
  passwordChanged: number | null;
  lastUsed: number | null;
  card: CardData | null;
  identity: IdentityData | null;
  fields: CustomField[];
  /** Senhas anteriores (mais recente primeiro, até 10). */
  history: PasswordHistoryEntry[];
  /** Na lixeira desde (null = ativo). Some de vez depois de 30 dias. */
  trashed: number | null;
}

export const emptyCard = (): CardData => ({ holder: '', number: '', brand: '', expiry: '', cvv: '', pin: '' });
export const emptyIdentity = (): IdentityData => ({ fullName: '', cpf: '', rg: '', birth: '', phone: '', email: '', address: '' });

/** Bandeira do cartão pelos primeiros dígitos. */
export function cardBrand(number: string): string {
  const n = number.replace(/\D/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'American Express';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(n)) return 'Elo';
  if (/^(606282|3841)/.test(n)) return 'Hipercard';
  if (/^(36|38|30[0-5])/.test(n)) return 'Diners';
  return '';
}

export interface Folder {
  id: string;
  name: string;
}

export interface Settings {
  autoLockMinutes: number;
  clipboardSeconds: number;
  /** Buscar ícones de sites na internet quando não houver um logo offline. */
  onlineIcons: boolean;
  /** Bloquear quando a janela é minimizada ou o app vai para segundo plano. */
  lockOnHide: boolean;
  /** Embaçar o conteúdo quando a janela perde o foco (contra olhares por cima do ombro). */
  privacyBlur: boolean;
  /** Esconder o app de prints, gravações e compartilhamento de tela. */
  screenProtect: boolean;
}

export interface VaultData {
  version: 1;
  items: Item[];
  folders: Folder[];
  settings: Settings;
  /** Id do item → quantas vezes a senha atual apareceu em vazamentos (resultado da última verificação). */
  breached: Record<string, number>;
  lastBreachCheck: number | null;
  lastBackup: number | null;
  lastChange: number;
  /** Itens excluídos (id → quando), para a exclusão chegar aos outros aparelhos. */
  deleted: Record<string, number>;
}

/** v1: dados cifrados direto com a chave derivada da senha mestra (versão 0.1). */
export interface SealedBlobV1 {
  app: 'cofre';
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

/** Cabeçalho da v2: a chave aleatória do cofre (DEK) embrulhada pela chave da senha mestra (KEK). */
export interface KeyHeader {
  /** Argon2id desde a 1.2 (resiste a placas de vídeo); PBKDF2 nos cofres antigos, trocado sozinho ao abrir. */
  kdf: 'PBKDF2-SHA256' | 'Argon2id';
  /** PBKDF2: iterações. Argon2id: passadas (t). */
  iter: number;
  /** Argon2id: memória em KiB (m) e paralelismo (p). */
  mem?: number;
  par?: number;
  salt: string;
  /** IV e DEK cifrada pela KEK. */
  wiv: string;
  wk: string;
  /** Quando a senha mestra foi definida/trocada — o cabeçalho mais novo vence na sincronização. */
  kt: number;
  /** Kit de Emergência: a DEK também embrulhada pela chave de recuperação (opcional). */
  rsalt?: string;
  riv?: string;
  rk?: string;
}

/** v2: dados cifrados com a DEK; trocar a senha mestra só re-embrulha a DEK. */
export interface SealedBlobV2 extends KeyHeader {
  app: 'cofre';
  v: 2;
  iv: string;
  ct: string;
}

export type SealedBlob = SealedBlobV1 | SealedBlobV2;

export const DEFAULT_SETTINGS: Settings = { autoLockMinutes: 5, clipboardSeconds: 30, onlineIcons: true, lockOnHide: false, privacyBlur: false, screenProtect: false };

export function emptyVault(): VaultData {
  return {
    version: 1,
    items: [],
    folders: [
      { id: 'pessoal', name: 'Pessoal' },
      { id: 'trabalho', name: 'Trabalho' },
      { id: 'financas', name: 'Finanças' },
      { id: 'familia', name: 'Família' }
    ],
    settings: { ...DEFAULT_SETTINGS },
    breached: {},
    lastBreachCheck: null,
    lastBackup: null,
    lastChange: Date.now(),
    deleted: {}
  };
}

export function newItem(partial: Partial<Item> = {}): Item {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    kind: 'login',
    name: '',
    url: '',
    username: '',
    password: '',
    otp: null,
    notes: '',
    recoveryCodes: '',
    folderId: null,
    tags: [],
    favorite: false,
    attachments: [],
    created: now,
    updated: now,
    passwordChanged: null,
    lastUsed: null,
    card: null,
    identity: null,
    fields: [],
    history: [],
    trashed: null,
    ...partial
  };
}
