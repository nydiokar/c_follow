#!/bin/bash

# Database Backup Script for Linux
# Usage: ./backup.sh [create|restore|list|cleanup] [backup-file]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
DATABASE_PATH="${DATABASE_URL:-./prisma/bot.db}"
MAX_BACKUPS="${MAX_BACKUPS:-30}"
COMPRESSION_LEVEL="${COMPRESSION_LEVEL:-6}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Ensure backup directory exists
ensure_backup_directory() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        mkdir -p "$BACKUP_DIR"
        log "Created backup directory: $BACKUP_DIR"
    fi
}

# Check if SQLite3 is available
check_sqlite3() {
    if ! command -v sqlite3 &> /dev/null; then
        warn "SQLite3 not found. Please install it for better backup integrity."
        warn "On Ubuntu/Debian: sudo apt-get install sqlite3"
        warn "On CentOS/RHEL: sudo yum install sqlite"
        return 1
    fi
    return 0
}

# Create backup
create_backup() {
    ensure_backup_directory
    
    local timestamp=$(date +"%Y-%m-%d_%H-%M-%S")
    local backup_name="bot-backup-$timestamp.db"
    local backup_path="$BACKUP_DIR/$backup_name"
    
    log "Creating backup: $backup_name"
    
    # Check if database file exists
    if [[ ! -f "$DATABASE_PATH" ]]; then
        error "Database file not found: $DATABASE_PATH"
        exit 1
    fi
    
    # Create backup using SQLite3 if available
    if check_sqlite3; then
        log "Using SQLite3 for backup (recommended)"
        sqlite3 "$DATABASE_PATH" "VACUUM INTO '$backup_path'"
    else
        warn "Using file copy method (fallback)"
        cp "$DATABASE_PATH" "$backup_path"
    fi
    
    if [[ -f "$backup_path" ]]; then
        # Compress the backup
        log "Compressing backup..."
        gzip -"$COMPRESSION_LEVEL" "$backup_path"
        
        local compressed_path="$backup_path.gz"
        local size=$(stat -c%s "$compressed_path")
        local size_mb=$(echo "scale=2; $size/1024/1024" | bc)
        
        log "✓ Backup created successfully: $backup_name.gz ($size_mb MB)"
        
        # Clean up old backups
        cleanup_old_backups
        
        echo "$compressed_path"
    else
        error "Backup file was not created"
        exit 1
    fi
}

# Restore backup
restore_backup() {
    local backup_file="$1"
    local backup_path="$BACKUP_DIR/$backup_file"
    
    if [[ ! -f "$backup_path" ]]; then
        error "Backup file not found: $backup_file"
        exit 1
    fi
    
    log "Restoring from backup: $backup_file"
    
    # Stop the bot if it's running
    if pm2 list | grep -q "follow-coin-bot"; then
        warn "Stopping bot before restore..."
        pm2 stop follow-coin-bot
        sleep 2
    fi
    
    # Create temporary decompressed file
    local temp_backup="$BACKUP_DIR/temp_restore.db"
    
    # Decompress backup
    log "Decompressing backup..."
    gunzip -c "$backup_path" > "$temp_backup"
    
    # Use SQLite3 for restore if available
    if check_sqlite3; then
        log "Using SQLite3 for restore (recommended)"
        sqlite3 "$DATABASE_PATH" ".restore '$temp_backup'"
    else
        warn "Using file copy method (fallback)"
        cp "$temp_backup" "$DATABASE_PATH"
    fi
    
    log "✓ Database restored successfully"
    
    # Restart the bot if it was running
    if pm2 list | grep -q "follow-coin-bot"; then
        log "Restarting bot..."
        pm2 start follow-coin-bot
    fi
    
    # Clean up temporary file
    rm -f "$temp_backup"
}

# Clean up old backups
cleanup_old_backups() {
    local files=($(ls -t "$BACKUP_DIR"/*.db.gz 2>/dev/null || true))
    local count=${#files[@]}
    
    if [[ $count -gt $MAX_BACKUPS ]]; then
        local to_delete=$((count - MAX_BACKUPS))
        log "Cleaning up $to_delete old backups..."
        
        for ((i=MAX_BACKUPS; i<count; i++)); do
            rm -f "${files[$i]}"
            log "Deleted: $(basename "${files[$i]}")"
        done
    fi
}

# List available backups
list_backups() {
    ensure_backup_directory
    
    local files=($(ls -t "$BACKUP_DIR"/*.db.gz 2>/dev/null || true))
    
    echo -e "\n${BLUE}Available backups:${NC}"
    echo "=================="
    
    if [[ ${#files[@]} -eq 0 ]]; then
        warn "No backups found"
        return
    fi
    
    for i in "${!files[@]}"; do
        local file="${files[$i]}"
        local filename=$(basename "$file")
        local size=$(stat -c%s "$file")
        local size_mb=$(echo "scale=2; $size/1024/1024" | bc)
        local date=$(stat -c%y "$file" | cut -d' ' -f1,2 | sed 's/ /_/')
        local age=$(get_age "$file")
        
        echo -e "$((i+1)). ${YELLOW}$filename${NC}"
        echo "   Size: $size_mb MB | Date: $date | Age: $age"
    done
    
    echo -e "\n${BLUE}Total backups: ${#files[@]}${NC}"
    echo -e "${BLUE}Max backups to keep: $MAX_BACKUPS${NC}"
}

# Get age of file
get_age() {
    local file="$1"
    local now=$(date +%s)
    local file_time=$(stat -c%Y "$file")
    local diff=$((now - file_time))
    
    local days=$((diff / 86400))
    local hours=$(((diff % 86400) / 3600))
    
    if [[ $days -gt 0 ]]; then
        echo "${days}d ${hours}h ago"
    elif [[ $hours -gt 0 ]]; then
        echo "${hours}h ago"
    else
        echo "Just now"
    fi
}

# Show help
show_help() {
    echo -e "${BLUE}Database Backup Tool for Linux${NC}"
    echo "============================="
    echo -e "${YELLOW}Usage:${NC}"
    echo "  $0 create     - Create a new backup"
    echo "  $0 restore <file> - Restore from backup"
    echo "  $0 list       - List available backups"
    echo "  $0 cleanup    - Clean up old backups"
    echo ""
    echo -e "${YELLOW}Environment variables:${NC}"
    echo "  DATABASE_URL     - Database file path (default: ./data/bot.db)"
    echo "  MAX_BACKUPS      - Maximum backups to keep (default: 30)"
    echo "  COMPRESSION_LEVEL - Gzip compression level 0-9 (default: 6)"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $0 create"
    echo "  $0 restore bot-backup-2024-01-15_14-30-00.db.gz"
    echo "  $0 list"
    echo ""
    echo -e "${YELLOW}Requirements:${NC}"
    echo "  - gzip (usually pre-installed)"
    echo "  - sqlite3 (recommended for better integrity)"
    echo "  - bc (for size calculations)"
}

# Main execution
main() {
    local command="${1:-help}"
    
    case "$command" in
        "create")
            create_backup
            ;;
        "restore")
            if [[ -z "$2" ]]; then
                error "Usage: $0 restore <backup-file>"
                exit 1
            fi
            restore_backup "$2"
            ;;
        "list")
            list_backups
            ;;
        "cleanup")
            cleanup_old_backups
            ;;
        "help"|*)
            show_help
            ;;
    esac
}

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v gzip &> /dev/null; then
        missing_deps+=("gzip")
    fi
    
    if ! command -v bc &> /dev/null; then
        missing_deps+=("bc")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        error "Missing required dependencies: ${missing_deps[*]}"
        error "Please install them:"
        error "  Ubuntu/Debian: sudo apt-get install ${missing_deps[*]}"
        error "  CentOS/RHEL: sudo yum install ${missing_deps[*]}"
        exit 1
    fi
}

# Run dependency check and main function
check_dependencies
main "$@"
