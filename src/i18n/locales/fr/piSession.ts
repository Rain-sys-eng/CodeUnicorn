export default {
  piSession: {
    fork: {
      title: "Créer une bifurcation depuis ce message",
      description:
        "Crée un nouveau fichier de session à partir du point situé avant ce message : le message devient un brouillon à réécrire et la session source reste intacte. La nouvelle branche apparaît dans le panneau d'arborescence des sessions (pas dans la barre latérale), avec bascule automatique après création.",
      cancel: "Annuler",
      confirm: "Créer la bifurcation",
      confirming: "Bifurcation…",
      successTitle: "✓ Bifurcation créée",
      successBody:
        "La nouvelle branche est visible dans le panneau d'arborescence à droite, et le message source est pré-rempli dans son champ de saisie — basculez pour continuer.",
      errorEntryNotFound:
        "Impossible de localiser ce message dans la session pi (il a peut-être été compacté).",
      errorEntryNotForkable:
        "Ce message n'est pas dans le fichier de session actuel — il appartient à une autre branche de l'arborescence (ou a été compacté) et ne peut pas être bifurqué d'ici. Dans l'arborescence, basculez d'abord vers la branche qui contient ce message (« ↪ »), puis bifurquez-le là-bas.",
    },
  },
};
