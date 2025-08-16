#!/bin/bash

# Follow Coin Bot - Linux Deployment Script
# This script sets up the complete environment for running the bot with PM2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
BACKUP_DIR="$PROJECT_ROOT/backups"
DATA_DIR="$PROJECT_ROOT/data"
LOGS_DIR="$PROJECT_ROOT/logs"

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root"
        error "Please run as a regular user with sudo privileges"
        exit 1
    fi
}

# Check system requirements
check_system() {
    log "Checking system requirements..."
    
    # Check OS
    if [[ ! -f /etc/os-release ]]; then
        error "Unsupported operating system"
        exit 1
    fi
    
    source /etc/os-release
    log "Detected OS: $NAME $VERSION"
    
    # Check Node.js version
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js 18+ first."
        error "Visit: https://nodejs.org/en/download/"
        exit 1
    fi
    
    local node_version=$(node --version | sed 's/v//')
    local major_version=$(echo "$node_version" | cut -d. -f1)
    
    if [[ $major_version -lt 18 ]]; then
        error "Node.js version $node_version is too old. Please install Node.js 18+"
        exit 1
    fi
    
    log "✓ Node.js version: $node_version"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        error "npm is not installed"
        exit 1
    fi
    
    log "✓ npm is available"
}

# Install system dependencies
install_system_deps() {
    log "Installing system dependencies..."
    
    source /etc/os-release
    
    if [[ "$ID" == "ubuntu" || "$ID" == "debian" ]]; then
        sudo apt-get update
        sudo apt-get install -y sqlite3 bc curl wget git build-essential
    elif [[ "$ID" == "centos" || "$ID" == "rhel" || "$ID" == "fedora" ]]; then
        if command -v dnf &> /dev/null; then
            sudo dnf install -y sqlite bc curl wget git gcc gcc-c++ make
        else
            sudo yum install -y sqlite bc curl wget git gcc gcc-c++ make
        fi
    else
        warn "Unsupported distribution. Please install manually:"
        warn "  - sqlite3"
        warn "  - bc"
        warn "  - curl"
        warn "  - wget"
        warn "  - git"
        warn "  - build-essential (gcc, make, etc.)"
    fi
    
    log "✓ System dependencies installed"
}

# Install PM2 globally
install_pm2() {
    log "Installing PM2..."
    
    if ! command -v pm2 &> /dev/null; then
        npm install -g pm2
        log "✓ PM2 installed globally"
    else
        local pm2_version=$(pm2 --version)
        log "✓ PM2 already installed (version: $pm2_version)"
    fi
    
    # Setup PM2 startup script
    pm2 startup
    log "✓ PM2 startup script configured"
}

# Create necessary directories
create_directories() {
    log "Creating necessary directories..."
    
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$DATA_DIR"
    mkdir -p "$LOGS_DIR"
    
    log "✓ Directories created"
}

# Setup environment file
setup_environment() {
    log "Setting up environment configuration..."
    
    local env_file="$PROJECT_ROOT/.env"
    local env_example="$PROJECT_ROOT/.env.example"
    
    if [[ ! -f "$env_file" ]]; then
        if [[ -f "$env_example" ]]; then
            cp "$env_example" "$env_file"
            warn "Created .env from .env.example"
            warn "Please edit .env with your actual configuration"
        else
            cat > "$env_file" << EOF
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Database
DATABASE_URL="file:./data/bot.db"

# Timezone (for anchor reports)
TIMEZONE=UTC

# API Configuration
DEXSCREENER_RATE_LIMIT_MS=200

# Process Configuration
NODE_ENV=production
LOG_LEVEL=info

# Backup Configuration
MAX_BACKUPS=30
COMPRESSION_LEVEL=6
EOF
            warn "Created default .env file"
            warn "Please edit .env with your actual configuration"
        fi
    else
        log "✓ .env file already exists"
    fi
}

# Install Node.js dependencies
install_dependencies() {
    log "Installing Node.js dependencies..."
    
    cd "$PROJECT_ROOT"
    npm install
    
    log "✓ Dependencies installed"
}

# Build the project
build_project() {
    log "Building the project..."
    
    cd "$PROJECT_ROOT"
    npm run build
    
    log "✓ Project built successfully"
}

# Setup database
setup_database() {
    log "Setting up database..."
    
    cd "$PROJECT_ROOT"
    
    # Generate Prisma client
    npx prisma generate
    
    # Push database schema
    npx prisma db push
    
    log "✓ Database setup complete"
}

# Configure PM2 ecosystem
configure_pm2() {
    log "Configuring PM2 ecosystem..."
    
    cd "$PROJECT_ROOT"
    
    # Check if ecosystem config exists
    if [[ ! -f "ecosystem.config.js" ]]; then
        error "ecosystem.config.js not found"
        exit 1
    fi
    
    log "✓ PM2 ecosystem configured"
}

# Setup automatic backups
setup_automatic_backups() {
    log "Setting up automatic backups..."
    
    # Make backup script executable
    chmod +x "$SCRIPT_DIR/backup.sh"
    
    # Create cron job for daily backups at 2 AM
    local cron_job="0 2 * * * cd $PROJECT_ROOT && $SCRIPT_DIR/backup.sh create >> $LOGS_DIR/backup.log 2>&1"
    
    # Check if cron job already exists
    if ! crontab -l 2>/dev/null | grep -q "backup.sh create"; then
        (crontab -l 2>/dev/null; echo "$cron_job") | crontab -
        log "✓ Daily backup cron job added (2 AM)"
    else
        log "✓ Backup cron job already exists"
    fi
    
    # Create log rotation for backup logs
    local logrotate_config="/etc/logrotate.d/follow-coin-backup"
    if [[ ! -f "$logrotate_config" ]]; then
        sudo tee "$logrotate_config" > /dev/null << EOF
$LOGS_DIR/backup.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 $USER $USER
}
EOF
        log "✓ Log rotation configured for backup logs"
    fi
}

# Setup log rotation for application logs
setup_log_rotation() {
    log "Setting up log rotation..."
    
    local logrotate_config="/etc/logrotate.d/follow-coin"
    if [[ ! -f "$logrotate_config" ]]; then
        sudo tee "$logrotate_config" > /dev/null << EOF
$LOGS_DIR/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 $USER $USER
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
        log "✓ Log rotation configured for application logs"
    fi
}

# Create systemd service (alternative to PM2 startup)
create_systemd_service() {
    log "Creating systemd service..."
    
    local service_file="/etc/systemd/system/follow-coin.service"
    if [[ ! -f "$service_file" ]]; then
        sudo tee "$service_file" > /dev/null << EOF
[Unit]
Description=Follow Coin Bot
After=network.target
Wants=network.target

[Service]
Type=forking
User=$USER
WorkingDirectory=$PROJECT_ROOT
ExecStart=/usr/bin/pm2 start ecosystem.config.js --env production
ExecReload=/usr/bin/pm2 reload ecosystem.config.js --env production
ExecStop=/usr/bin/pm2 stop ecosystem.config.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
        sudo systemctl daemon-reload
        sudo systemctl enable follow-coin.service
        log "✓ Systemd service created and enabled"
    else
        log "✓ Systemd service already exists"
    fi
}

# Create management scripts
create_management_scripts() {
    log "Creating management scripts..."
    
    cd "$PROJECT_ROOT"
    
    # Start script
    cat > "start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
pm2 start ecosystem.config.js --env production
echo "Bot started. Check status with: pm2 status"
EOF
    
    # Stop script
    cat > "stop.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
pm2 stop ecosystem.config.js
echo "Bot stopped."
EOF
    
    # Restart script
    cat > "restart.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
pm2 restart ecosystem.config.js --env production
echo "Bot restarted."
EOF
    
    # Status script
    cat > "status.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
pm2 status
pm2 logs --lines 20
EOF
    
    # Make scripts executable
    chmod +x start.sh stop.sh restart.sh status.sh
    
    log "✓ Management scripts created"
}

# Display final instructions
show_final_instructions() {
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}  Follow Coin Bot Setup Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "1. Edit .env file with your Telegram bot credentials:"
    echo "   - TELEGRAM_BOT_TOKEN"
    echo "   - TELEGRAM_CHAT_ID"
    echo ""
    echo "2. Start the bot:"
    echo "   ./start.sh"
    echo ""
    echo "3. Check status:"
    echo "   ./status.sh"
    echo ""
    echo "4. Useful commands:"
    echo "   ./start.sh      - Start the bot"
    echo "   ./stop.sh       - Stop the bot"
    echo "   ./restart.sh    - Restart the bot"
    echo "   ./status.sh     - Check status and logs"
    echo "   pm2 monit       - Monitor processes"
    echo "   pm2 logs        - View logs"
    echo ""
    echo "5. Backup commands:"
    echo "   ./scripts/backup.sh create  - Create backup"
    echo "   ./scripts/backup.sh list    - List backups"
    echo "   ./scripts/backup.sh restore <file> - Restore backup"
    echo ""
    echo -e "${BLUE}Automatic features:${NC}"
    echo "✓ Daily database backups at 2 AM"
    echo "✓ Log rotation (30 days retention)"
    echo "✓ PM2 process management"
    echo "✓ Auto-restart on failures"
    echo ""
    echo -e "${GREEN}Happy trading! 🚀${NC}"
}

# Main deployment function
deploy() {
    log "Starting Follow Coin Bot deployment..."
    
    check_root
    check_system
    install_system_deps
    install_pm2
    create_directories
    setup_environment
    install_dependencies
    build_project
    setup_database
    configure_pm2
    setup_automatic_backups
    setup_log_rotation
    create_systemd_service
    create_management_scripts
    
    log "✓ Deployment completed successfully!"
    show_final_instructions
}

# Show help
show_help() {
    echo -e "${BLUE}Follow Coin Bot - Linux Deployment Script${NC}"
    echo "=============================================="
    echo ""
    echo -e "${YELLOW}Usage:${NC}"
    echo "  $0 [deploy|help]"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  deploy  - Run full deployment (default)"
    echo "  help    - Show this help message"
    echo ""
    echo -e "${YELLOW}What this script does:${NC}"
    echo "  - Installs system dependencies"
    echo "  - Installs PM2 process manager"
    echo "  - Sets up Node.js environment"
    echo "  - Configures automatic backups"
    echo "  - Sets up log rotation"
    echo "  - Creates management scripts"
    echo "  - Configures systemd service"
    echo ""
    echo -e "${YELLOW}Requirements:${NC}"
    echo "  - Ubuntu/Debian/CentOS/RHEL/Fedora"
    echo "  - Node.js 18+"
    echo "  - sudo privileges"
    echo "  - Internet connection"
}

# Main execution
main() {
    local command="${1:-deploy}"
    
    case "$command" in
        "deploy")
            deploy
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
