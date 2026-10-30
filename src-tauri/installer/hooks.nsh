; Ganchos do instalador do Cofre (NSIS).
; Textos próprios nas telas de boas-vindas e de conclusão, no lugar dos genéricos.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "金庫  Preparando o Cofre…"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "金庫  Cofre instalado. Seus dados ficam cifrados neste aparelho."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removendo o Cofre. Seu cofre cifrado continua guardado neste usuário do Windows."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend

!define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao Cofre"
!define MUI_WELCOMEPAGE_TEXT "Seu cofre de senhas e códigos 2FA, cifrado no seu aparelho e sincronizado entre Windows, Android e Chrome.$\r$\n$\r$\nClique em Avançar para instalar."
!define MUI_FINISHPAGE_TITLE "Tudo em seu lugar."
!define MUI_FINISHPAGE_TEXT "O Cofre foi instalado.$\r$\n$\r$\nAbra o app para criar sua conta ou entrar — e não esqueça de guardar o seu Kit de Emergência."
