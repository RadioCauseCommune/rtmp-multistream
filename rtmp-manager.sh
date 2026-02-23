#!/bin/bash

# ============================================================================
# Script de gestion nginx-rtmp - Radio Cause Commune
# Facilite les opérations courantes sur le serveur de streaming
# ============================================================================

set -e

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ============================================================================
# Fonctions utilitaires
# ============================================================================

print_banner() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║         🎥 Nginx-RTMP Manager - Radio Cause Commune       ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker n'est pas installé"
        echo "Installation: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi
    
    if ! command -v docker compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose n'est pas installé"
        exit 1
    fi
}

# ============================================================================
# Commandes principales
# ============================================================================

cmd_start() {
    print_info "Démarrage du serveur nginx-rtmp..."
    cd "$SCRIPT_DIR"
    docker compose up -d
    print_success "Serveur démarré"
    cmd_status
}

cmd_stop() {
    print_info "Arrêt du serveur nginx-rtmp..."
    cd "$SCRIPT_DIR"
    docker compose down
    print_success "Serveur arrêté"
}

cmd_restart() {
    print_info "Redémarrage du serveur nginx-rtmp..."
    cd "$SCRIPT_DIR"
    docker compose restart
    print_success "Serveur redémarré"
}

cmd_status() {
    print_info "État du serveur:"
    cd "$SCRIPT_DIR"
    docker compose ps
    
    echo ""
    print_info "Accès:"
    echo "  📊 Stats XML:     http://$(hostname -I | awk '{print $1}'):8080/stat"
    echo "  📈 Dashboard:     http://$(hostname -I | awk '{print $1}'):8081"
    echo "  🎬 Stream URL:    rtmp://$(hostname -I | awk '{print $1}'):1935/live"
    echo "  📁 Enregistrements: http://$(hostname -I | awk '{print $1}'):8080/recordings/"
}

cmd_logs() {
    local service="${1:-nginx-rtmp}"
    print_info "Logs de $service (Ctrl+C pour quitter):"
    cd "$SCRIPT_DIR"
    docker-compose logs -f "$service"
}

cmd_stats() {
    print_info "Statistiques en temps réel..."
    local ip=$(hostname -I | awk '{print $1}')
    
    # Fetch stats XML
    if command -v curl &> /dev/null; then
        curl -s "http://$ip:8080/stat" | head -50
    else
        print_error "curl n'est pas installé"
    fi
}

cmd_test() {
    print_info "Test de connexion au serveur RTMP..."
    local ip=$(hostname -I | awk '{print $1}')
    
    # Test port RTMP
    if nc -zv "$ip" 1935 2>&1 | grep -q succeeded; then
        print_success "Port RTMP 1935 accessible"
    else
        print_error "Port RTMP 1935 non accessible"
    fi
    
    # Test port HTTP stats
    if nc -zv "$ip" 8080 2>&1 | grep -q succeeded; then
        print_success "Port HTTP 8080 accessible"
    else
        print_error "Port HTTP 8080 non accessible"
    fi
    
    # Test health endpoint
    if curl -s "http://$ip:8080/health" | grep -q healthy; then
        print_success "Serveur en bonne santé"
    else
        print_warning "Serveur potentiellement en erreur"
    fi

    # Test tunnel RTMPS
    if docker ps | grep -q rtmp-tunnel-cc; then
        print_success "Tunnel RTMPS opérationnel"
    else
        print_error "Tunnel RTMPS non trouvé"
    fi
}

cmd_update_keys() {
    print_info "Utilisez le script dédié pour la rotation des clés :"
    echo "  ./rotate-keys.sh"
}

cmd_backup() {
    print_info "Sauvegarde de la configuration et des enregistrements..."
    
    local backup_dir="$SCRIPT_DIR/backups/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"
    
    # Backup config
    [ -f "$SCRIPT_DIR/nginx.conf.template" ] && cp "$SCRIPT_DIR/nginx.conf.template" "$backup_dir/"
    [ -f "$SCRIPT_DIR/.env" ] && cp "$SCRIPT_DIR/.env" "$backup_dir/"
    [ -f "$SCRIPT_DIR/docker-compose.yml" ] && cp "$SCRIPT_DIR/docker-compose.yml" "$backup_dir/"
    [ -f "$SCRIPT_DIR/stunnel.conf" ] && cp "$SCRIPT_DIR/stunnel.conf" "$backup_dir/"
    
    # Backup recordings (optionnel, peut être lourd)
    # cp -r "$SCRIPT_DIR/recordings" "$backup_dir/"
    
    print_success "Backup créé: $backup_dir"
}

cmd_recordings() {
    print_info "Enregistrements disponibles:"
    
    if [ -d "$SCRIPT_DIR/recordings" ]; then
        ls -lh "$SCRIPT_DIR/recordings" | tail -n +2
    else
        print_warning "Aucun enregistrement trouvé"
    fi
}

cmd_clean_recordings() {
    print_warning "Cette action va supprimer les enregistrements de plus de 30 jours"
    read -p "Continuer? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        find "$SCRIPT_DIR/recordings" -name "*.flv" -mtime +30 -delete
        print_success "Anciens enregistrements supprimés"
    else
        print_info "Annulé"
    fi
}

cmd_setup() {
    print_info "Configuration initiale du serveur nginx-rtmp..."
    
    # Créer les répertoires nécessaires
    mkdir -p "$SCRIPT_DIR/recordings"
    mkdir -p "$SCRIPT_DIR/logs"
    mkdir -p "$SCRIPT_DIR/hls"
    mkdir -p "$SCRIPT_DIR/dash"
    mkdir -p "$SCRIPT_DIR/backups"
    
    print_success "Répertoires créés"
    
    # Vérifier les fichiers de config
    if [ ! -f "$SCRIPT_DIR/nginx.conf.template" ]; then
        print_error "nginx.conf.template non trouvé"
        exit 1
    fi
    
    if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
        print_error "docker-compose.yml non trouvé"
        exit 1
    fi
    
    print_success "Fichiers de configuration OK"
    
    # Créer le fichier .env si nécessaire
    if [ ! -f "$SCRIPT_DIR/.env" ]; then
        print_warning "Fichier .env non trouvé. Création depuis .env.example..."
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        print_info "Éditez .env avec vos clés de stream"
    fi
    
    print_success "Configuration initiale terminée"
    print_info "Prochaine étape: éditez .env avec vos vraies clés, puis lancez ./rtmp-manager.sh start"
}

cmd_monitor() {
    print_info "Monitoring en temps réel (Ctrl+C pour quitter)..."
    
    while true; do
        clear
        print_banner
        cmd_stats
        echo ""
        echo -e "${BLUE}Mise à jour dans 5 secondes...${NC}"
        sleep 5
    done
}

cmd_help() {
    print_banner
    echo "Usage: $0 <commande> [options]"
    echo ""
    echo "Commandes disponibles:"
    echo "  setup              Configuration initiale du serveur"
    echo "  start              Démarrer le serveur"
    echo "  stop               Arrêter le serveur"
    echo "  restart            Redémarrer le serveur"
    echo "  status             Afficher l'état du serveur"
    echo "  logs [service]     Afficher les logs (défaut: nginx-rtmp)"
    echo "  stats              Afficher les statistiques"
    echo "  monitor            Monitoring en temps réel"
    echo "  test               Tester la connectivité"
    echo "  update-keys        Mettre à jour les clés de streaming"
    echo "  backup             Sauvegarder la configuration"
    echo "  recordings         Lister les enregistrements"
    echo "  clean-recordings   Supprimer les vieux enregistrements"
    echo "  help               Afficher cette aide"
    echo ""
    echo "Exemples:"
    echo "  $0 setup           # Configuration initiale"
    echo "  $0 start           # Démarrer le serveur"
    echo "  $0 logs            # Voir les logs en temps réel"
    echo "  $0 monitor         # Monitoring continu"
    echo ""
}

# ============================================================================
# Point d'entrée
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        cmd_help
        exit 0
    fi
    
    check_docker
    
    case "$1" in
        setup)
            cmd_setup
            ;;
        start)
            cmd_start
            ;;
        stop)
            cmd_stop
            ;;
        restart)
            cmd_restart
            ;;
        status)
            cmd_status
            ;;
        logs)
            cmd_logs "${2:-nginx-rtmp}"
            ;;
        stats)
            cmd_stats
            ;;
        monitor)
            cmd_monitor
            ;;
        test)
            cmd_test
            ;;
        update-keys)
            cmd_update_keys
            ;;
        backup)
            cmd_backup
            ;;
        recordings)
            cmd_recordings
            ;;
        clean-recordings)
            cmd_clean_recordings
            ;;
        help|--help|-h)
            cmd_help
            ;;
        *)
            print_error "Commande inconnue: $1"
            echo ""
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
