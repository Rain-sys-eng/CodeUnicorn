export default {
  piSession: {
    fork: {
      title: "Bifurcar desde este mensaje",
      description:
        "Crea un nuevo archivo de sesión desde el punto anterior a este mensaje: el mensaje queda como borrador para reescribir y la sesión original no se modifica. La nueva rama aparece en el panel del árbol de sesiones (no en la barra lateral) y saltarás a ella automáticamente.",
      cancel: "Cancelar",
      confirm: "Crear bifurcación",
      confirming: "Bifurcando…",
      successTitle: "✓ Bifurcación creada",
      successBody:
        "La nueva rama está en el panel del árbol de sesiones a la derecha, con el mensaje original ya en su borrador de entrada — salta para continuar.",
      errorEntryNotFound:
        "No se pudo localizar este mensaje en la sesión de pi (puede que se haya compactado).",
      errorEntryNotForkable:
        "Este mensaje no está en el archivo de sesión actual: pertenece a otra rama del árbol de sesiones (o fue compactado), así que no se puede bifurcar desde aquí. En el árbol, salta primero a la rama que contiene este mensaje (↪) y bifúrcalo allí.",
    },
  },
};
