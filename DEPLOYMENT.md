# Follow Coin Bot - Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Follow Coin Bot in production environments. The system is designed for single-instance deployment with SQLite, optimized for reliability and performance.

## Prerequisites

### System Requirements

#### Minimum Requirements
- **OS**: Linux (Ubuntu 20.04+), Windows 10+, macOS 10.15+
- **Node.js**: Version 18.0.0 or higher
- **RAM**: 512MB available memory
- **Storage**: 2GB free disk space
- **Network**: Stable internet connection

#### Recommended Requirements  
- **OS**: Ubuntu 22.04 LTS or CentOS 8+
- **Node.js**: Version 20.x LTS
- **RAM**: 1GB dedicated memory
- **Storage**: 5GB SSD storage
- **CPU**: 2+ cores for optimal performance

#### Dependencies
```bash
# Required packages
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Optional but recommended
sudo apt-get install -y sqlite3 htop
```

### External Services

#### Telegram Bot Setup
1. **Create Bot with BotFather**
   ```
   /start
   /newbot
   follow_coin_bot (or your preferred name)
   follow_coin_bot (username)
   ```

2. **Get Bot Token**
   - Save the token (format: `123456789:ABCdef...`)
   - Keep this token secure and never commit to version control

3. **Get Chat ID**
   ```bash
   # Start conversation with your bot first
   curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   
   # Look for "chat":{"id": YOUR_CHAT_ID}
   ```

#### DexScreener API
- No API key required
- Public API with rate limiting
- Test connectivity: `curl https://api.dexscreener.com/latest/dex/tokens/solana`

## Environment Configuration

### Environment Variables

Create `.env` file in project root:

```bash
# Required Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
DATABASE_URL=file:./prisma/data/bot.db

# Optional Configuration
NODE_ENV=production
TIMEZONE=UTC
DEXSCREENER_RATE_LIMIT_MS=200
LOG_LEVEL=info

# Advanced Configuration (Optional)
MAX_CONCURRENT_JOBS=5
HEALTH_CHECK_INTERVAL=60000
CLEANUP_INTERVAL=21600
BACKUP_INTERVAL=86400
```

### Configuration Details

#### Required Variables
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
- `TELEGRAM_CHAT_ID`: Chat ID where alerts will be sent
- `DATABASE_URL`: SQLite database file path

#### Optional Variables
- `NODE_ENV`: Environment mode (`production`, `development`, `test`)
- `TIMEZONE`: Timezone for scheduled reports (e.g., `America/New_York`)
- `DEXSCREENER_RATE_LIMIT_MS`: Minimum milliseconds between API calls
- `LOG_LEVEL`: Logging verbosity (`error`, `warn`, `info`, `debug`)

#### Advanced Variables
- `MAX_CONCURRENT_JOBS`: Maximum background jobs to run simultaneously
- `HEALTH_CHECK_INTERVAL`: Health check frequency in milliseconds
- `CLEANUP_INTERVAL`: Data cleanup frequency in seconds
- `BACKUP_INTERVAL`: Database backup frequency in seconds

### Environment Validation

The system validates required environment variables on startup:

```typescript
const requiredEnvVars = [
  'TELEGRAM_BOT_TOKEN', 
  'TELEGRAM_CHAT_ID', 
  'DATABASE_URL'
];

const missing = requiredEnvVars.filter(key => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
```

## Installation

### From Source

#### 1. Clone Repository
```bash
git clone <repository-url>
cd follow-coin-bot
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Setup Database
```bash
# Generate Prisma client
npm run db:generate

# Initialize database schema
npm run db:push
```

#### 4. Build Application
```bash
npm run build
```

#### 5. Verify Installation
```bash
# Run tests
npm test

# Check TypeScript compilation
npm run build

# Verify environment
node -e "console.log('Node.js version:', process.version)"
```

### Production Build

#### Optimized Build Process
```bash
# Install production dependencies only
npm ci --only=production

# Build with optimizations
NODE_ENV=production npm run build

# Verify build output
ls -la dist/
```

#### Build Artifacts
- `dist/`: Compiled JavaScript files
- `prisma/`: Database schema and generated client
- `node_modules/`: Production dependencies
- `package-lock.json`: Dependency lock file

## Database Setup

### SQLite Configuration

#### Database File Structure
```
prisma/
├── data/
│   ├── bot.db           # Main database file
│   ├── bot.db-wal       # Write-ahead log
│   └── bot.db-shm       # Shared memory file
└── schema.prisma        # Database schema
```

#### Permissions Setup
```bash
# Create database directory
mkdir -p prisma/data

# Set appropriate permissions
chmod 755 prisma/data
chmod 644 prisma/data/bot.db

# For production systems
chown app:app prisma/data
```

#### WAL Mode Optimization
The system automatically configures WAL mode for better performance:

```sql
-- Applied automatically on first connection
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA cache_size=10000;
PRAGMA temp_store=memory;
```

### Database Migrations

#### Initial Setup
```bash
# Generate Prisma client
npx prisma generate

# Apply schema to database
npx prisma db push

# Verify schema
npx prisma studio  # Opens web interface
```

#### Migration Management
```bash
# Create new migration
npx prisma migrate dev --name description

# Apply migrations in production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### Backup Configuration

#### Automated Backups
The system includes automated backup functionality:

```typescript
// Backup configuration
const backupConfig = {
  enabled: process.env.NODE_ENV === 'production',
  interval: parseInt(process.env.BACKUP_INTERVAL || '86400'), // 24 hours
  retentionDays: 7,
  compressionEnabled: true
};
```

#### Manual Backup
```bash
# Create manual backup
cp prisma/data/bot.db "backups/bot-$(date +%Y%m%d-%H%M%S).db"

# Compressed backup
tar -czf "backups/bot-$(date +%Y%m%d-%H%M%S).tar.gz" prisma/data/
```

## Process Management

### PM2 Configuration

#### ecosystem.config.js
```javascript
module.exports = {
  apps: [{
    name: 'follow-coin-bot',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    
    // Environment
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Process management
    restart_delay: 5000,
    max_restarts: 5,
    min_uptime: '10s',
    
    // Logging
    log_file: 'logs/app.log',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Monitoring
    monitoring: false,
    pmx: false,
    
    // Advanced options
    kill_timeout: 5000,
    listen_timeout: 3000,
    shutdown_with_message: true
  }]
};
```

#### PM2 Commands
```bash
# Start application
pm2 start ecosystem.config.js

# Monitor status
pm2 status
pm2 monit

# View logs
pm2 logs follow-coin-bot
pm2 logs follow-coin-bot --lines 100

# Restart application
pm2 restart follow-coin-bot

# Stop application
pm2 stop follow-coin-bot

# Delete application
pm2 delete follow-coin-bot

# Save PM2 configuration
pm2 save
pm2 startup
```

### Systemd Service (Alternative)

#### Service File: `/etc/systemd/system/follow-coin-bot.service`
```ini
[Unit]
Description=Follow Coin Bot
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/opt/follow-coin-bot
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=follow-coin-bot

[Install]
WantedBy=multi-user.target
```

#### Systemd Commands
```bash
# Enable and start service
sudo systemctl enable follow-coin-bot
sudo systemctl start follow-coin-bot

# Check status
sudo systemctl status follow-coin-bot

# View logs
sudo journalctl -u follow-coin-bot -f

# Restart service
sudo systemctl restart follow-coin-bot
```

## Security Configuration

### File Permissions

#### Production Permissions
```bash
# Application files
chmod 644 package.json tsconfig.json
chmod 644 prisma/schema.prisma
chmod 600 .env  # Sensitive configuration

# Executable files
chmod 755 dist/index.js

# Database files
chmod 644 prisma/data/bot.db
chmod 755 prisma/data/

# Log files
chmod 644 logs/*.log
chmod 755 logs/
```

#### User Setup
```bash
# Create dedicated user
sudo useradd -r -s /bin/false app

# Set ownership
sudo chown -R app:app /opt/follow-coin-bot

# Restrict access
sudo chmod 750 /opt/follow-coin-bot
```

### Network Security

#### Firewall Configuration
```bash
# Allow SSH (if needed)
sudo ufw allow 22/tcp

# Allow outbound HTTPS (for APIs)
sudo ufw allow out 443/tcp

# Allow outbound HTTP (for APIs)
sudo ufw allow out 80/tcp

# Enable firewall
sudo ufw enable
```

#### Environment Security
- Store `.env` file outside web-accessible directory
- Use environment-specific configuration files
- Never commit sensitive data to version control
- Rotate API tokens regularly

### Monitoring Access

#### Log File Security
```bash
# Create secure log directory
sudo mkdir -p /var/log/follow-coin-bot
sudo chown app:app /var/log/follow-coin-bot
sudo chmod 750 /var/log/follow-coin-bot

# Configure log rotation
sudo nano /etc/logrotate.d/follow-coin-bot
```

#### Logrotate Configuration
```
/var/log/follow-coin-bot/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 app app
}
```

## Monitoring and Logging

### Application Logging

#### Log Levels
- **error**: Critical errors requiring immediate attention
- **warn**: Warning conditions that should be reviewed
- **info**: General operational information
- **debug**: Detailed debugging information

#### Log Configuration
```typescript
// Winston logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/app.log' 
    })
  ]
});
```

### Health Monitoring

#### Health Check Endpoint
The application exposes health status for monitoring:

```bash
# Check application health
curl http://localhost:3000/health

# Response format
{
  "status": "healthy",
  "timestamp": "2024-12-15T14:30:00.000Z",
  "services": {
    "database": "connected",
    "dexscreener": "available",
    "telegram": "connected",
    "jobQueue": "running"
  },
  "metrics": {
    "uptime": 86400,
    "memoryUsage": "145MB",
    "dbConnections": 1
  }
}
```

#### Monitoring Scripts
```bash
#!/bin/bash
# health-check.sh
response=$(curl -s http://localhost:3000/health)
status=$(echo $response | jq -r '.status')

if [ "$status" != "healthy" ]; then
    echo "ALERT: Application unhealthy"
    echo $response | jq .
    exit 1
fi

echo "Application healthy"
```

### Performance Monitoring

#### Key Metrics
- **Response times**: API call latencies
- **Memory usage**: RAM consumption trends
- **Database performance**: Query execution times
- **Error rates**: Application error frequency
- **Alert delivery**: Message success rates

#### Metrics Collection
```typescript
// Application metrics
const metrics = {
  uptime: process.uptime(),
  memoryUsage: process.memoryUsage(),
  cpuUsage: process.cpuUsage(),
  dbQueries: dbMetrics.getTotalQueries(),
  alertsSent: alertMetrics.getTotalSent(),
  errorCount: errorMetrics.getTotalErrors()
};
```

## Backup and Recovery

### Backup Strategy

#### Automated Backups
```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/opt/backups/follow-coin-bot"
DB_FILE="prisma/data/bot.db"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
cp $DB_FILE "$BACKUP_DIR/bot-$DATE.db"

# Backup configuration
cp .env "$BACKUP_DIR/env-$DATE.backup"

# Compress backup
tar -czf "$BACKUP_DIR/complete-$DATE.tar.gz" \
    $DB_FILE .env logs/

# Cleanup old backups (keep 7 days)
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/complete-$DATE.tar.gz"
```

#### Backup Schedule
```bash
# Crontab entry for daily backups
0 2 * * * /opt/follow-coin-bot/scripts/backup.sh
```

### Recovery Procedures

#### Database Recovery
```bash
# Stop application
pm2 stop follow-coin-bot

# Restore database
cp backups/bot-YYYYMMDD-HHMMSS.db prisma/data/bot.db

# Verify restore
sqlite3 prisma/data/bot.db ".tables"

# Start application
pm2 start follow-coin-bot
```

#### Configuration Recovery
```bash
# Restore environment configuration
cp backups/env-YYYYMMDD-HHMMSS.backup .env

# Verify configuration
node -e "console.log(require('dotenv').config())"
```

#### Disaster Recovery
1. **Prepare clean environment** with same Node.js version
2. **Restore application code** from version control
3. **Install dependencies**: `npm ci --only=production`
4. **Restore database** from latest backup
5. **Restore configuration** files
6. **Verify environment** variables and permissions
7. **Start services** and confirm operation

## Performance Optimization

### Production Optimizations

#### Node.js Configuration
```bash
# Set production environment
export NODE_ENV=production

# Optimize garbage collection
export NODE_OPTIONS="--max-old-space-size=512"

# Enable production optimizations
export NODE_ENV=production
```

#### SQLite Optimizations
```sql
-- Applied automatically
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA cache_size=10000;
PRAGMA temp_store=memory;
PRAGMA mmap_size=268435456;
```

#### Memory Management
```typescript
// Garbage collection hints
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 300000); // Every 5 minutes
}
```

### Scaling Considerations

#### Current Limits
- **Concurrent users**: 100+ Telegram users
- **Coins tracked**: 1000+ simultaneously
- **Alert frequency**: Sub-second detection
- **Message throughput**: 60 messages/minute (Telegram limit)

#### Horizontal Scaling Options
1. **Database**: Migrate to PostgreSQL for multi-instance support
2. **Message Queue**: Add Redis for distributed job processing
3. **Load Balancing**: Multiple bot instances with shared database
4. **Caching**: Redis for hot data caching

## Maintenance

### Regular Maintenance Tasks

#### Daily
- Monitor application health and logs
- Check disk space and memory usage
- Verify database integrity
- Review error logs

#### Weekly
- Update dependencies (after testing)
- Rotate and archive logs
- Clean up old data according to retention policy
- Performance metrics review

#### Monthly
- Security updates and patches
- Full system backup verification
- Capacity planning review
- Documentation updates

### Update Procedures

#### Application Updates
```bash
# Backup current state
./scripts/backup.sh

# Pull latest code
git pull origin main

# Install dependencies
npm ci --only=production

# Run database migrations
npx prisma migrate deploy

# Build application
npm run build

# Restart service
pm2 restart follow-coin-bot

# Verify operation
pm2 logs follow-coin-bot --lines 50
```

#### Emergency Rollback
```bash
# Stop current version
pm2 stop follow-coin-bot

# Restore previous backup
cp backups/latest-working/bot.db prisma/data/bot.db

# Checkout previous version
git checkout <previous-commit>

# Rebuild and restart
npm run build
pm2 start follow-coin-bot
```

This deployment guide provides comprehensive instructions for production deployment. Follow security best practices and monitor the system regularly for optimal performance.