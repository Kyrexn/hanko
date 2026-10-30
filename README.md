# 判子 Hanko

**Selado. Só você abre.** Gerenciador de senhas e códigos 2FA gratuito e de código aberto, com criptografia de ponta a ponta.
Windows, Android e extensão para Chrome/Edge, sincronizados.

## Por que confiar

- **Conhecimento zero.** Tudo é cifrado no seu aparelho antes de sair dele. O servidor só guarda dados cifrados; nem nós conseguimos ler o seu cofre.
- **Criptografia moderna.** Senha mestra → **Argon2id** (64 MiB, 3 passadas) → chave que embrulha a chave aleatória do cofre (**AES-256-GCM**). Trocar a senha mestra só re-embrulha a chave.
- **Kit de Emergência.** Uma chave de recuperação de 150 bits, que só você guarda, abre o cofre se você esquecer a senha mestra.
- **Código aberto (GPL-3.0).** Qualquer pessoa pode auditar como o Hanko protege os seus dados.

## O que faz

- Senhas, códigos 2FA (TOTP e HOTP), cartões, identidades, notas seguras e fotos de documentos
- Gerador de senhas e frases-senha, saúde do cofre (fracas, repetidas e vazadas via Have I Been Pwned com k-anonimato)
- Desbloqueio com Windows Hello ou digital, bloqueio automático, proteção contra prints
- Área de transferência limpa sozinha e fora do histórico do Windows (Win+V)
- Extensão: preenchimento só no site certo (proteção contra phishing e iframes), salvar logins, senha forte em cadastros, atalho `Ctrl+Shift+L`
- Importa de Chrome, Edge, Bitwarden, 1Password, LastPass e Google Authenticator

## Baixar

As versões ficam em **Releases**. No Windows o Hanko se atualiza sozinho, em silêncio, quando você fecha o app. No Android, um toque baixa e abre o instalador. A extensão é instalada pela pasta que o app do Windows mantém (Ajustes → Extensão) e se atualiza junto com ele.

## Compilar

Requisitos: Node 20+, Rust estável, e para Android o SDK/NDK.

```bash
npm install
cp .env.example .env.local   # endereço e chave pública do seu projeto Supabase
npm test                     # testes do núcleo (criptografia, 2FA, sincronização)
npm run tauri dev            # app em modo desenvolvimento
node extension/build.mjs     # extensão em extension/dist
```

O servidor de sincronização é um projeto Supabase comum: rode `supabase/schema.sql` e os arquivos de `supabase/migrations/` no SQL Editor.

## Estrutura

| Pasta | O quê |
| --- | --- |
| `src/core/` | Núcleo sem interface: criptografia, TOTP/HOTP, senhas, importação, junção de cofres |
| `src/app/` | Interface React (computador e celular) |
| `src-tauri/` | App nativo (Tauri 2): área de transferência segura, Windows Hello, updates, extensão embutida |
| `src-tauri/gen/android/` | Projeto Android (biometria, proteção de tela, update de 1 toque) |
| `extension/` | Extensão Chrome/Edge (Manifest V3) |
| `installer/` | Instalador próprio do Windows |
| `supabase/` | Esquema do banco, políticas de acesso e modelos de e-mail |

## Segurança

Achou uma falha? Veja [SECURITY.md](SECURITY.md). Política de privacidade: [PRIVACIDADE.md](PRIVACIDADE.md).

## Licença

[GPL-3.0](LICENSE). Você pode usar, estudar, modificar e redistribuir; versões modificadas distribuídas precisam continuar abertas sob a mesma licença.
