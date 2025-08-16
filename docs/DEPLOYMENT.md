# Follow Coin Bot - Linux Deployment Guide

This guide covers deploying the Follow Coin Bot on Linux servers with PM2 process management, automatic database backups, and **self-monitoring with Telegram alerts**.

## 🚀 Quick Commands Reference

```bash
# Start the bot
npm run pm2:start

# Check status
npm run pm2:status

# View logs
npm run pm2:logs

# Deploy updates
npm run deploy

# Create backup
npm run backup

# Start monitoring
npm run monitor:start

# Stop the bot
npm run pm2:stop
```

## 🚀 Quick Start

### 1. Prerequisites

- **Linux Server**: Ubuntu 20.04+, Debian 11+, CentOS 8+, or RHEL 8+
- **Node.js**: Version 18 or higher
- **User Account**: Non-root user with sudo privileges
- **Internet Access**: For downloading dependencies
- **Git**: For cloning the repository

### 2. One-Command Deployment

```bash
# Clone the repository
git clone https://github.com/nydiokar/c_follow.git
cd c_follow

# Make scripts executable and run deployment
chmod +x scripts/*.sh
./scripts/deploy.sh
```

**⚠️ Important**: Always make scripts executable after cloning! The `chmod +x scripts/*.sh` command is required.

The deployment script will:
- ✅ Install system dependencies
- ✅ Install PM2 globally
- ✅ Set up Node.js environment
- ✅ Configure automatic backups
- ✅ Set up log rotation
- ✅ Create management scripts
- ✅ Configure systemd service
- ✅ **Set up health monitoring endpoints**

The deployment script will:
- ✅ Install system dependencies
- ✅ Install PM2 globally
- ✅ Set up Node.js environment
- ✅ Configure automatic backups
- ✅ Set up log rotation
- ✅ Create management scripts
- ✅ Configure systemd service

## 📋 Manual Setup (Alternative)

If you prefer manual setup or need to customize the installation:

**⚠️ Remember**: After cloning, make scripts executable with `chmod +x scripts/*.sh`

### 1. Install System Dependencies

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y sqlite3 bc curl wget git build-essential
```

**CentOS/RHEL/Fedora:**
```bash
# For CentOS/RHEL
sudo yum install -y sqlite bc curl wget git gcc gcc-c++ make

# For Fedora
sudo dnf install -y sqlite bc curl wget git gcc gcc-c++ make
```

### 2. Install Node.js (if not already installed)

```bash
# Using NodeSource repository (recommended)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or download from nodejs.org
wget https://nodejs.org/dist/v18.19.0/node-v18.19.0-linux-x64.tar.xz
sudo tar -xf node-v18.19.0-linux-x64.tar.xz -C /usr/local --strip-components=1
```

### 3. Install PM2

```bash
npm install -g pm2
pm2 startup
```

### 4. Setup Project

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Setup database
npx prisma generate
npx prisma db push
```

### 5. Configure Environment

Create a `.env` file:

```env
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
```

## 🔧 PM2 Configuration

The bot uses PM2 for process management. The configuration is in `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'follow-coin-bot',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    node_args: '--max-old-space-size=512',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};
```

## 🏥 Health Monitoring & Self-Healing

### Built-in Health Check Endpoints

The bot now includes **built-in health monitoring** that runs on port 3002 (configurable):

```bash
# Health check endpoint
curl http://localhost:3002/health

# Status endpoint
curl http://localhost:3002/status
```

**Health Check Response:**
```json
{
  "status": "healthy",
  "uptime": 86400,
  "timestamp": "2024-12-15T14:30:00.000Z",
  "environment": "production",
  "services": {
    "database": { "healthy": true, "latency": 5 },
    "jobQueue": { "healthy": true, "pendingJobs": 0 },
    "alertBus": { "healthy": true, "subscribers": 1 },
    "dexscreener": { "healthy": true, "latency": 150 },
    "telegram": { "healthy": true, "connected": true },
    "scheduler": true
  },
  "metrics": {
    "memoryUsage": { "rss": 145000000, "heapUsed": 89000000 },
    "cpuUsage": { "user": 1200000, "system": 500000 },
    "rateLimitStats": { "requestsPerMinute": 45 },
    "errorStats": { "totalErrors": 2, "lastError": "2024-12-15T10:00:00Z" }
  }
}
```

### Self-Monitoring Features

- **Automatic Health Checks**: Bot checks itself every 5 minutes
- **Telegram Alerts**: Sends alerts when health checks fail
- **Self-Healing**: Attempts automatic restart after 30 minutes offline
- **Performance Metrics**: Memory, CPU, and service health monitoring

### External Monitoring Script

For **24/7 monitoring**, use the external monitoring script:

```bash
# Start monitoring (checks every 5 minutes)
npm run monitor:start

# Check monitoring status
npm run monitor:status

# Stop monitoring
npm run monitor:stop
```

**Monitoring Features:**
- ✅ **Health Check Monitoring**: Checks bot health endpoint every 5 minutes
- ✅ **PM2 Process Monitoring**: Verifies PM2 process is running
- ✅ **Telegram Alerts**: Sends critical alerts when bot is down
- ✅ **Auto-Restart**: Automatically restarts bot after 30 minutes offline
- ✅ **Alert Cooldown**: Prevents spam (30 minutes between alerts)
- ✅ **Detailed Logging**: All monitoring activity is logged

**Environment Variables for Monitoring:**
```env
HEALTH_CHECK_PORT=3001      # Bot health check port
CHECK_INTERVAL=300          # Check interval in seconds (5 min)
MAX_FAILURES=3              # Alert after 3 consecutive failures
```

## 💾 Automatic Database Backups

### Backup Features

- **Daily Backups**: Automatic backups at 2 AM
- **Compression**: Gzip compression to save disk space
- **Rotation**: Keeps last 30 backups by default
- **Integrity**: Uses SQLite3 VACUUM for safe backups
- **Fallback**: File copy method if SQLite3 unavailable

### Backup Commands

```bash
# Create backup
./scripts/backup.sh create

# List backups
./scripts/backup.sh list

# Restore from backup
./scripts/backup.sh restore bot-backup-2024-01-15_14-30-00.db.gz

# Clean up old backups
./scripts/backup.sh cleanup
```

**⚠️ Note**: Ensure backup script is executable: `chmod +x scripts/backup.sh`

### Backup Configuration

Environment variables for backup customization:

```env
MAX_BACKUPS=30              # Number of backups to keep
COMPRESSION_LEVEL=6         # Gzip compression (0-9)
DATABASE_URL=./data/bot.db  # Database path
```

### Cron Job

Daily backups are scheduled via cron:

```bash
# View cron jobs
crontab -l

# The backup job runs at 2 AM daily
0 2 * * * cd /path/to/project && ./scripts/backup.sh create >> ./logs/backup.log 2>&1
```

## 📊 Management Commands

### NPM Scripts (Recommended)

The project includes comprehensive npm scripts for easy PM2 management:

```bash
# PM2 Management
npm run pm2:start      # Start the bot in production
npm run pm2:stop       # Stop the bot
npm run pm2:restart    # Restart the bot
npm run pm2:reload     # Zero-downtime reload
npm run pm2:status     # Check PM2 status
npm run pm2:logs       # View bot logs
npm run pm2:monit      # Monitor processes

# Deployment
npm run deploy         # Build and reload (zero-downtime)
npm run deploy:full    # Full rebuild and restart

# Database
npm run db:generate    # Generate Prisma client
npm run db:push        # Push database schema
npm run db:migrate     # Run migrations
npm run db:studio      # Open Prisma Studio

# Backups
npm run backup         # Create database backup
npm run backup:list    # List available backups
npm run backup:cleanup # Clean old backups

# Monitoring
npm run monitor:start  # Start health monitoring
npm run monitor:stop   # Stop health monitoring
npm run monitor:status # Check monitoring status

# Development
npm run build          # Build TypeScript
npm run dev            # Build and run in dev mode
npm run test           # Run tests
npm run lint           # Check code style
```

### PM2 Commands

#### Direct PM2 Commands
```bash
# Start the bot
pm2 start ecosystem.config.js --env production

# Stop the bot
pm2 stop ecosystem.config.js

# Restart the bot
pm2 restart ecosystem.config.js --env production

# View status
pm2 status

# View logs
pm2 logs follow-coin-bot

# Monitor processes
pm2 monit

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
```

#### NPM Scripts (Recommended)
```bash
# Start the bot
npm run pm2:start

# Stop the bot
npm run pm2:stop

# Restart the bot
npm run pm2:restart

# View status
npm run pm2:status

# View logs
npm run pm2:logs

# Monitor processes
npm run pm2:monit

# Deploy updates
npm run deploy

# Full redeploy
npm run deploy:full

# Backup operations
npm run backup
npm run backup:list
npm run backup:cleanup
```

### Management Scripts

The deployment creates convenient management scripts:

```bash
./start.sh      # Start the bot
./stop.sh       # Stop the bot
./restart.sh    # Restart the bot
./status.sh     # Check status and recent logs
```

## 🔄 Log Management

### Log Files

- **Application Logs**: `./logs/combined.log`
- **PM2 Logs**: `./logs/pm2-*.log`
- **Backup Logs**: `./logs/backup.log`

### Log Rotation

Logs are automatically rotated:
- **Application logs**: 30 days retention
- **Backup logs**: 7 days retention
- **Compression**: Enabled for old logs

### Viewing Logs

```bash
# View application logs
tail -f logs/combined.log

# View PM2 logs
pm2 logs follow-coin-bot

# View backup logs
tail -f logs/backup.log

# Search logs
grep "ERROR" logs/combined.log
```

## 🚀 Production Deployment

**⚠️ Deployment Checklist**:
1. ✅ Clone repository: `git clone https://github.com/nydiokar/c_follow.git`
2. ✅ Make scripts executable: `chmod +x scripts/*.sh`
3. ✅ Run deployment: `./scripts/deploy.sh`
4. ✅ Configure environment: Edit `.env` file
5. ✅ Start the bot: `npm run pm2:start` or `./start.sh`
6. ✅ **Start monitoring**: `npm run monitor:start`
7. ✅ **Verify health**: `curl http://localhost:3001/health`

### 1. Server Preparation

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install firewall (if not already configured)
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
```

### 2. SSL/HTTPS (Optional)

If you need HTTPS for health checks:

```bash
# Install Certbot
sudo apt-get install certbot

# Get SSL certificate
sudo certbot certonly --standalone -d yourdomain.com
```

### 3. Environment Variables

For production, consider using a proper secrets management system:

```bash
# Create production environment file
sudo nano /etc/environment

# Add your variables
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
NODE_ENV=production
```

### 4. Monitoring Setup

**Start the monitoring service:**
```bash
# Start monitoring (runs in background)
npm run monitor:start

# Check if monitoring is running
npm run monitor:status

# View monitoring logs
tail -f logs/monitor.log
```

**Set up monitoring to start automatically:**
```bash
# Add to crontab for auto-start on reboot
crontab -e

# Add this line:
@reboot cd /path/to/project && npm run monitor:start
```

### 5. Systemd Service

The deployment creates a systemd service for automatic startup:

```bash
# Enable the service
sudo systemctl enable follow-coin.service

# Start the service
sudo systemctl start follow-coin.service

# Check status
sudo systemctl status follow-coin.service
```

## 📈 Monitoring & Health Checks

### PM2 Monitoring

```bash
# Real-time monitoring
pm2 monit

# Process information
pm2 show follow-coin-bot

# Performance metrics
pm2 status
```

### Health Check Endpoint

The bot includes a health check endpoint (in development mode):

```bash
# Check if bot is responding
curl http://localhost:3000/health
```

### Log Monitoring

```bash
# Monitor for errors
tail -f logs/combined.log | grep ERROR

# Monitor for warnings
tail -f logs/combined.log | grep WARN

# Monitor backup operations
tail -f logs/backup.log
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Bot Not Starting

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs follow-coin-bot

# Check environment
cat .env

# Verify database
ls -la data/
```

#### 2. Backup Failures

```bash
# Check backup script permissions
ls -la scripts/backup.sh

# Check cron jobs
crontab -l

# Check backup logs
tail -f logs/backup.log

# Test backup manually
./scripts/backup.sh create
```

#### 3. Database Issues

```bash
# Check database file
ls -la data/bot.db

# Check Prisma status
npx prisma db push

# Verify schema
npx prisma generate
```

#### 4. Memory Issues

```bash
# Check memory usage
pm2 monit

# Check system memory
free -h

# Restart with memory limit
pm2 restart follow-coin-bot --max-memory-restart 1G
```

#### 5. Monitoring Issues

```bash
# Check if monitoring is running
npm run monitor:status

# Check monitoring logs
tail -f logs/monitor.log

# Check health endpoint manually
curl http://localhost:3001/health

# Restart monitoring
npm run monitor:stop
npm run monitor:start
```

#### 6. Health Check Issues

```bash
# Check if health server is running
netstat -tlnp | grep :3002

# Check bot logs for health server errors
pm2 logs follow-coin-bot | grep "health"

# Verify environment variables
grep HEALTH_CHECK_PORT .env
```

### Performance Optimization

#### 1. Database Optimization

```bash
# Enable WAL mode for better performance
sqlite3 data/bot.db "PRAGMA journal_mode=WAL;"

# Optimize database
sqlite3 data/bot.db "VACUUM; ANALYZE;"
```

#### 2. PM2 Optimization

```bash
# Use cluster mode for better performance
pm2 start ecosystem.config.js --env production -i max

# Monitor memory usage
pm2 monit
```

#### 3. System Optimization

```bash
# Increase file descriptor limits
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf

# Optimize kernel parameters
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

## 🔒 Security Considerations

### 1. File Permissions

```bash
# Secure sensitive files
chmod 600 .env
chmod 600 data/bot.db
chmod 700 scripts/
chmod 700 backups/
```

### 2. Firewall Configuration

```bash
# Only allow necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw enable
```

### 3. User Isolation

```bash
# Create dedicated user for the bot
sudo adduser followcoin
sudo usermod -aG sudo followcoin

# Run bot as dedicated user
sudo -u followcoin pm2 start ecosystem.config.js
```

## 📚 Additional Resources

### Documentation

- [PM2 Documentation](https://pm2.keymetrics.io/docs/)
- [Node.js Production Best Practices](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
- [SQLite Optimization](https://www.sqlite.org/optoverview.html)

### Monitoring Tools

- [PM2 Plus](https://pm2.io/docs/plus/overview/) - Advanced monitoring
- [Grafana](https://grafana.com/) - Metrics visualization
- [Prometheus](https://prometheus.io/) - Metrics collection

### Backup Solutions

- [Rclone](https://rclone.org/) - Cloud backup integration
- [AWS S3](https://aws.amazon.com/s3/) - Cloud storage
- [Google Cloud Storage](https://cloud.google.com/storage) - Alternative cloud storage

## 🆘 Support

## 🆕 What's New in This Version

### **Health Monitoring & Self-Healing**
- ✅ **Built-in Health Endpoints**: `/health` and `/status` on port 3001
- ✅ **Self-Monitoring**: Bot checks itself every 5 minutes
- ✅ **Telegram Alerts**: Automatic notifications when bot is down
- ✅ **Auto-Restart**: Attempts recovery after 30 minutes offline
- ✅ **External Monitor**: 24/7 monitoring script with `npm run monitor:start`

### **Enhanced PM2 Management**
- ✅ **Comprehensive NPM Scripts**: All PM2 operations via npm
- ✅ **Zero-Downtime Deployment**: `npm run deploy` for seamless updates
- ✅ **Automatic Backups**: Daily compressed database backups
- ✅ **Log Rotation**: Automatic log management and cleanup

### **Production Ready**
- ✅ **One-Command Deployment**: `./scripts/deploy.sh`
- ✅ **Systemd Integration**: Automatic startup on boot
- ✅ **Security Best Practices**: User isolation and file permissions
- ✅ **Performance Monitoring**: Memory, CPU, and service metrics

---

If you encounter issues:

1. **Check logs**: `pm2 logs follow-coin-bot`
2. **Verify configuration**: Check `.env` and `ecosystem.config.js`
3. **Test components**: Run backup script manually
4. **Check system resources**: `htop`, `df -h`, `free -h`
5. **Review this guide**: Ensure all steps were followed
6. **Verify script permissions**: Ensure `chmod +x scripts/*.sh` was run

**Common Permission Issues**:
```bash
# If you get "Permission denied" errors:
chmod +x scripts/*.sh
chmod +x start.sh stop.sh restart.sh status.sh

# If backup script fails:
chmod +x scripts/backup.sh
```

For additional help, check the project's GitHub issues or create a new one with detailed error information.
