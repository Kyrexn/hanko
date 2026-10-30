# Política de privacidade do Hanko

Última atualização: 30 de outubro de 2026.

O Hanko foi feito para saber o mínimo possível sobre você. Esta política explica o que é coletado e por quê, conforme a Lei Geral de Proteção de Dados (LGPD).

## O que fica só com você

Suas senhas, códigos 2FA, cartões, documentos, notas e a senha mestra **nunca** chegam ao servidor de forma legível. Tudo é cifrado no seu aparelho antes de qualquer envio. Não temos como ler, recuperar ou entregar esse conteúdo a ninguém.

## O que o servidor guarda (só se você criar uma conta)

| Dado | Para quê |
| --- | --- |
| E-mail | Entrar na conta, confirmar o cadastro e recuperar o acesso |
| Nome (opcional) | Mostrar nos e-mails da conta |
| Cofre e anexos **cifrados** | Sincronizar seus aparelhos |
| Segredo de login derivado da senha mestra | Autenticar a conta (não abre o cofre) |
| Datas de criação, acesso e atualização | Funcionamento e segurança da conta |

Sem conta, o Hanko funciona só no aparelho e nada é enviado.

## Serviços de terceiros

- **Supabase** (servidor de sincronização e e-mails da conta) — recebe os dados da tabela acima.
- **Have I Been Pwned** (opcional, ao verificar vazamentos) — recebe só os 5 primeiros caracteres de um resumo (hash) de cada senha; a senha não sai do aparelho.
- **DuckDuckGo** (opcional, ícones dos sites) — recebe só o domínio do site do item. Pode ser desligado em Ajustes.

Não usamos rastreadores, publicidade nem análise de uso.

## Seus direitos

Você pode exportar seus dados (Ajustes → Dados e backup) e **excluir a conta e tudo o que está no servidor** a qualquer momento (Ajustes → Conta e sincronia → Excluir conta). Dúvidas: **juliocesar@biocypher.tech**.
