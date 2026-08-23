export default {
  piSession: {
    fork: {
      title: "Bifurcar a partir desta mensagem",
      description:
        "Cria um novo arquivo de sessão no ponto anterior a esta mensagem: a mensagem vira um rascunho para reescrever e a sessão original permanece intacta. O novo branch aparece no painel da árvore de sessões (não na barra lateral), com salto automático após a criação.",
      cancel: "Cancelar",
      confirm: "Criar bifurcação",
      confirming: "Bifurcando…",
      successTitle: "✓ Bifurcação criada",
      successBody:
        "O novo branch está no painel da árvore de sessões à direita, com a mensagem de origem preenchida no rascunho do composer — salte para continuar.",
      errorEntryNotFound:
        "Não foi possível localizar esta mensagem na sessão pi (ela pode ter sido compactada).",
      errorEntryNotForkable:
        "Esta mensagem não está no arquivo de sessão atual — ela pertence a outro branch da árvore de sessões (ou foi compactada), então não pode ser bifurcada daqui. Na árvore, salte primeiro para o branch que contém esta mensagem (↪) e depois bifurque lá.",
    },
  },
};
