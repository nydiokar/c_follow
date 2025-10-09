#!/bin/bash

# Bot Health Monitoring Script
# This script monitors the Follow Coin Bot and sends alerts if it's down

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
HEALTH_CHECK_PORT="${HEALTH_CHECK_PORT:-3002}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"   # 1 minute - faster detection
MAX_FAILURES="${MAX_FAILURES:-2}"       # Alert after 2 consecutive failures
LOG_FILE="$PROJECT_ROOT/logs/monitor.log"
ALERT_LOG="$PROJECT_ROOT/logs/monitor-alerts.log"
PID_FILE="$PROJECT_ROOT/logs/monitor.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE" >&2
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

# Check if bot is running
check_bot_health() {
    local response
    local status
    
    # Try to connect to health endpoint
    if response=$(curl -s -m 10 "http://localhost:$HEALTH_CHECK_PORT/health" 2>/dev/null); then
        if status=$(echo "$response" | jq -r '.status' 2>/dev/null); then
            if [ "$status" = "healthy" ]; then
                return 0  # Success
            else
                warn "Bot health check returned: $status"
                return 1  # Failure
            fi
        else
            warn "Invalid JSON response from health endpoint"
            return 1  # Failure
        fi
    else
        warn "Failed to connect to health endpoint on port $HEALTH_CHECK_PORT"
        return 1  # Failure
    fi
}

# Check if PM2 process is running
check_pm2_process() {
    if pm2 list | grep -q "follow-coin-bot.*online"; then
        return 0  # Success
    else
        warn "PM2 process 'follow-coin-bot' is not running"
        return 1  # Failure
    fi
}

# Send Telegram alert
send_telegram_alert() {
    local message="$1"
    local level="$2"
    
    # Load environment variables
    if [ -f "$PROJECT_ROOT/.env" ]; then
        export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
    fi
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
        error "Telegram credentials not found in .env file"
        return 1
    fi
    
    local alert_text="🚨 **Bot Monitor Alert**\n\n"$message"\n\n"\
"**Level**: $level\n"\
"**Time**: $(date -u +'%Y-%m-%d %H:%M:%S UTC')\n"\
"**Server**: $(hostname)\n"\
"**Port**: $HEALTH_CHECK_PORT"
    
    # Send via Telegram API
    local telegram_url="https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"
    local payload="{\"chat_id\":\"$TELEGRAM_CHAT_ID\",\"text\":\"$alert_text\",\"parse_mode\":\"MarkdownV2\"}"
    
    if curl -s -X POST "$telegram_url" \
        -H "Content-Type: application/json" \
        -d "$payload" > /dev/null; then
        log "Telegram alert sent successfully"
        echo "$(date -u +'%Y-%m-%d %H:%M:%S UTC') - $level: $message" >> "$ALERT_LOG"
        return 0
    else
        error "Failed to send Telegram alert"
        return 1
    fi
}

# Attempt to restart the bot
restart_bot() {
    warn "Attempting to restart the bot..."
    
    cd "$PROJECT_ROOT"
    
    # Try to restart via PM2
    if pm2 restart follow-coin-bot; then
        log "Bot restart initiated via PM2"
        
        # Wait a bit and check if it's back up
        sleep 30
        
        if check_bot_health; then
            log "Bot is back online after restart"
            send_telegram_alert "Bot has been automatically restarted and is now online" "info"
            return 0
        else
            warn "Bot restart failed - still offline"
            return 1
        fi
    else
        error "Failed to restart bot via PM2"
        return 1
    fi
}

# Check if monitor is already running
check_if_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0  # Already running
        else
            # Stale PID file
            rm -f "$PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Main monitoring loop
main() {
    # Check if already running
    if check_if_running; then
        error "Monitor is already running (PID: $(cat $PID_FILE))"
        exit 1
    fi

    # Write PID file
    echo $$ > "$PID_FILE"

    log "Bot monitoring started (PID: $$)"
    log "Health check port: $HEALTH_CHECK_PORT"
    log "Check interval: ${CHECK_INTERVAL}s"
    log "Max failures before alert: $MAX_FAILURES"

    local consecutive_failures=0
    local last_alert_time=0
    local alert_cooldown=300   # 5 minutes between duplicate alerts (reduced from 30 mins)
    local last_restart_time=0
    local restart_cooldown=300 # 5 minutes between restart attempts (reduced from 10 mins)
    
    while true; do
        local current_time=$(date +%s)
        local health_ok=false
        local pm2_ok=false
        
        # Check PM2 process
        if check_pm2_process; then
            pm2_ok=true
        fi
        
        # Check bot health
        if check_bot_health; then
            health_ok=true
            
            # If bot was previously down, send recovery notification
            if [ $consecutive_failures -gt 0 ]; then
                log "✅ Bot is back online after $consecutive_failures failed checks"
                send_telegram_alert "✅ Bot is back online and responding to health checks" "info"
            fi
            
            consecutive_failures=0  # Reset failure count
        else
            consecutive_failures=$((consecutive_failures + 1))
            warn "Bot health check failed (attempt $consecutive_failures/$MAX_FAILURES)"
        fi
        
        # Determine overall status
        if [ "$pm2_ok" = true ] && [ "$health_ok" = true ]; then
            log "✅ Bot is healthy"
        elif [ "$pm2_ok" = true ] && [ "$health_ok" = false ]; then
            warn "⚠️ PM2 process running but health check failing"
        else
            error "❌ Bot is completely offline"
        fi
        
        # Send alert and restart if needed
        if [ $consecutive_failures -ge $MAX_FAILURES ]; then
            local time_since_last_alert=$((current_time - last_alert_time))
            local time_since_last_restart=$((current_time - last_restart_time))
            
            # Send alert (with shorter cooldown)
            if [ $time_since_last_alert -ge $alert_cooldown ]; then
                local alert_message="Bot is offline for $consecutive_failures consecutive health checks"
                
                if [ "$pm2_ok" = false ]; then
                    alert_message="🚨 CRITICAL: Bot PM2 process is not running - attempting restart"
                elif [ "$health_ok" = false ]; then
                    alert_message="🚨 CRITICAL: Bot health check is failing - attempting restart"
                fi
                
                # Always send alert immediately when bot goes down
                send_telegram_alert "$alert_message" "critical"
                last_alert_time=$current_time
            fi
            
            # Try to restart immediately after MAX_FAILURES - no cooldown on first restart attempt
            if [ $last_restart_time -eq 0 ] || [ $time_since_last_restart -ge $restart_cooldown ]; then
                warn "Bot has been down for $consecutive_failures checks - attempting immediate restart"
                if restart_bot; then
                    last_restart_time=$current_time
                    consecutive_failures=0  # Reset on successful restart
                else
                    error "Restart failed - will try again in $restart_cooldown seconds"
                    last_restart_time=$current_time
                fi
            else
                warn "Restart cooldown active ($(($restart_cooldown - $time_since_last_restart))s remaining)"
            fi
        fi
        
        # Sleep until next check
        sleep $CHECK_INTERVAL
    done
}

# Handle script termination
cleanup() {
    log "Bot monitoring stopped (PID: $$)"
    rm -f "$PID_FILE"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
    fi
    
    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi
    
    if ! command -v pm2 &> /dev/null; then
        missing_deps+=("pm2")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}"
        error "Please install them:"
        error "  Ubuntu/Debian: sudo apt-get install ${missing_deps[*]}"
        error "  CentOS/RHEL: sudo yum install ${missing_deps[*]}"
        exit 1
    fi
}

# Show help
show_help() {
    echo -e "${BLUE}Bot Health Monitoring Script${NC}"
    echo "============================="
    echo ""
    echo -e "${YELLOW}Usage:${NC}"
    echo "  $0 [start|stop|status|help]"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  start   - Start monitoring (default)"
    echo "  stop    - Stop monitoring"
    echo "  status  - Check current status"
    echo "  help    - Show this help message"
    echo ""
    echo -e "${YELLOW}Environment variables:${NC}"
    echo "  HEALTH_CHECK_PORT - Bot health check port (default: 3002)"
    echo "  CHECK_INTERVAL   - Check interval in seconds (default: 300)"
    echo "  MAX_FAILURES     - Max failures before alert (default: 3)"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $0 start"
    echo "  HEALTH_CHECK_PORT=3002 $0 start"
    echo "  CHECK_INTERVAL=60 $0 start"
}

# Check command line arguments
case "${1:-start}" in
    "start")
        check_dependencies
        main
        ;;
    "stop")
        if [ -f "$PID_FILE" ]; then
            local pid=$(cat "$PID_FILE")
            if ps -p "$pid" > /dev/null 2>&1; then
                kill "$pid"
                rm -f "$PID_FILE"
                log "Monitoring stopped (PID: $pid)"
            else
                warn "Monitor not running, removing stale PID file"
                rm -f "$PID_FILE"
            fi
        else
            warn "Monitor not running (no PID file found)"
        fi
        ;;
    "status")
        if check_bot_health; then
            echo "✅ Bot is healthy"
        else
            echo "❌ Bot health check failed"
        fi
        
        if check_pm2_process; then
            echo "✅ PM2 process is running"
        else
            echo "❌ PM2 process is not running"
        fi
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
