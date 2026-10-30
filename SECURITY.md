# Segurança do Hanko

## Como relatar uma falha

Não abra uma issue pública para falhas de segurança. Envie os detalhes para **juliocesar@biocypher.tech** com o assunto `[Hanko] segurança`, incluindo:

- versão do Hanko e plataforma (Windows, Android, extensão);
- passos para reproduzir e o impacto esperado;
- se possível, uma prova de conceito.

Você recebe uma resposta em até 7 dias. Pedimos que a falha não seja divulgada até existir uma correção publicada.

## Modelo de segurança

- **Cifra no aparelho.** O cofre é cifrado com AES-256-GCM por uma chave aleatória (DEK). A DEK é embrulhada pela chave derivada da senha mestra com Argon2id (64 MiB, 3 passadas). Cofres antigos com PBKDF2-SHA256 (600 mil iterações) são migrados automaticamente ao abrir.
- **Servidor sem acesso.** O servidor (Supabase) recebe só o cofre cifrado e os anexos cifrados. O login na conta usa um segredo derivado da senha mestra com outro sal; a senha mestra nunca é enviada. Políticas de linha (RLS) garantem que cada conta só acessa os próprios dados, e com 2FA da conta ligado exigem sessão verificada (aal2).
- **Kit de Emergência.** A DEK também pode ser embrulhada por uma chave de recuperação aleatória de 150 bits, que só o usuário guarda.
- **Desbloqueio rápido.** Windows: a DEK fica protegida pelo DPAPI do usuário e só é aberta após o Windows Hello. Android: cifrada por uma chave do Keystore que exige biometria e é invalidada se uma digital nova for cadastrada. Nunca sincroniza.
- **Extensão.** Só entrega a senha quando o domínio-base da página principal e do quadro (iframe) que pede batem com o do item; hospedagens compartilhadas (github.io, vercel.app…) exigem o endereço exato; páginas sem HTTPS não recebem senhas. A chave do cofre fica só na memória da sessão do navegador.
- **Atualizações.** Windows: instaladores assinados (minisign) e verificados antes de rodar. Android: o sistema recusa APKs com assinatura diferente da instalada. A extensão vem embutida no app do Windows e é coberta pela mesma assinatura.

## Fora do escopo

Um aparelho já comprometido por malware rodando com o seu usuário pode ler o que você digita e a memória dos programas; nenhum gerenciador de senhas protege contra isso.
