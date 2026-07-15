#!/usr/bin/env bash
# install.sh — Installa o aggiorna Zen Maximize nell'ambiente GNOME dell'utente corrente.
#
# Uso:
#   ./install.sh          # installa / aggiorna
#   ./install.sh --remove # disinstalla

set -euo pipefail

# ──────────────────────────────────────────────
# Configurazione
# ──────────────────────────────────────────────
UUID="zen-maximize@albeph"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# File e cartelle da copiare (esclude .git, _repoFiles, ecc.)
ITEMS=(
    extension.js
    prefs.js
    metadata.json
    src
    schemas
    locale
)

# ──────────────────────────────────────────────
# Colori
# ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[zen-maximize]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[zen-maximize]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[zen-maximize]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[zen-maximize]${RESET} $*" >&2; }

# ──────────────────────────────────────────────
# Rimozione
# ──────────────────────────────────────────────
do_remove() {
    if [[ ! -d "$DEST_DIR" ]]; then
        warn "L'estensione non è installata in: $DEST_DIR"
        exit 0
    fi

    info "Rimozione di $DEST_DIR …"
    rm -rf "$DEST_DIR"
    success "Estensione rimossa."
    _prompt_restart
    exit 0
}

# ──────────────────────────────────────────────
# Installazione / aggiornamento
# ──────────────────────────────────────────────
do_install() {
    local version
    version="$(grep '"version"' "$SCRIPT_DIR/metadata.json" | grep -oP '[\d.]+')"

    info "Installazione di Zen Maximize v${version} …"
    info "Destinazione: $DEST_DIR"

    # Crea la directory di destinazione
    mkdir -p "$DEST_DIR"

    # Copia i file dell'estensione
    for item in "${ITEMS[@]}"; do
        local src="$SCRIPT_DIR/$item"
        if [[ -e "$src" ]]; then
            cp -r "$src" "$DEST_DIR/"
        else
            warn "Non trovato (saltato): $item"
        fi
    done

    # Compila lo schema GSettings
    local schema_dir="$DEST_DIR/schemas"
    if [[ -d "$schema_dir" ]]; then
        info "Compilazione dello schema GSettings …"
        if command -v glib-compile-schemas &>/dev/null; then
            glib-compile-schemas "$schema_dir"
            success "Schema compilato."
        else
            warn "glib-compile-schemas non trovato — lo schema non è stato compilato."
            warn "Installa 'glib2' o 'libglib2.0-bin' e riesegui lo script."
        fi
    fi

    success "Estensione installata con successo in: $DEST_DIR"
    _prompt_restart
}

# ──────────────────────────────────────────────
# Suggerimento riavvio
# ──────────────────────────────────────────────
_prompt_restart() {
    echo
    if [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
        # Su X11 si può riavviare la shell in-session
        read -rp "$(echo -e "${YELLOW}Vuoi riavviare GNOME Shell adesso? (s/N): ${RESET}")" answer
        if [[ "${answer,,}" == "s" ]]; then
            info "Riavvio di GNOME Shell …"
            busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…", global.context)' 2>/dev/null \
                || gnome-shell --replace &>/dev/null &
            success "Riavvio avviato."
        else
            warn "Riavvia manualmente GNOME Shell (Alt+F2 → digita 'r') oppure esegui il logout."
        fi
    else
        # Su Wayland non è possibile riavviare la shell senza fare logout
        warn "Sessione Wayland rilevata: è necessario fare ${BOLD}logout e ri-login${RESET} per applicare le modifiche."
    fi
}

# ──────────────────────────────────────────────
# Punto d'ingresso
# ──────────────────────────────────────────────
case "${1:-install}" in
    --remove|-r|remove)
        do_remove
        ;;
    --install|-i|install|"")
        do_install
        ;;
    --help|-h|help)
        echo -e "${BOLD}Uso:${RESET}"
        echo "  ./install.sh              # installa o aggiorna"
        echo "  ./install.sh --remove     # disinstalla"
        echo "  ./install.sh --help       # mostra questo aiuto"
        ;;
    *)
        error "Argomento non riconosciuto: $1"
        echo "Usa --help per vedere le opzioni disponibili."
        exit 1
        ;;
esac
