# Follow Coin Bot

A Telegram bot for tracking cryptocurrency price movements with advanced trigger systems and real-time alerts.

## Features

### Long List (Persistent Monitoring)
- **Retracement Alerts**: Notifications when coins drop from 72-hour highs
- **Momentum Stall Detection**: Identifies when volume drops while price stagnates
- **Breakout Notifications**: Alerts for price breakouts with volume confirmation
- **Market Cap Thresholds**: Custom market cap level alerts
- **Configurable Triggers**: Per-coin customization of all trigger parameters

### Hot List (Quick Alerts)
- **Percentage Targets**: Set specific percentage change alerts from anchor price
- **Market Cap Milestones**: Alert when coins reach target market cap levels
- **60% Drawdown Failsafe**: Automatic alert for significant losses (always active)
- **One-shot Triggers**: Alerts fire once and remove themselves

### Advanced Features
- **Rate Limiting**: Prevents alert spam with configurable cooldowns
- **Data Validation**: Anomaly detection for suspicious price movements
- **Circuit Breakers**: Automatic recovery from API failures
- **Scheduled Reports**: Regular anchor reports at configured times
- **Alert Deduplication**: Prevents duplicate notifications

## Quick Start

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd follow-coin
npm install
```

2. **Set up environment:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Initialize database:**
```bash
npm run db:generate
npm run db:push
```

4. **Start the bot:**
```bash
npm run dev
```

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

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
```

### Getting Telegram Credentials

1. **Create a bot:**
   - Message @BotFather on Telegram
   - Send `/newbot` and follow instructions
   - Save the bot token

2. **Get your chat ID:**
   - Send a message to your bot
   - Visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Find your chat ID in the response

## Commands

### Long List Commands

```bash
/long_add SYMBOL              # Add coin to long list
/long_rm SYMBOL               # Remove coin from long list
/long_trigger retrace on|off  # Toggle trigger types
/long_set SYMBOL retrace=15   # Set custom thresholds
/report_now                   # Generate immediate report
```

### Hot List Commands

```bash
/hot_add SYMBOL pct=-5 mcap=100000  # Add with targets
/hot_rm SYMBOL                      # Remove from hot list
/hot_list                          # Show all entries
/alerts                            # Show recent alerts
```

### Example Usage

```bash
# Add Bitcoin to long list
/long_add BTC

# Add Solana with custom retracement threshold
/long_set SOL retrace=20

# Add to hot list with -10% alert and 1M market cap target
/hot_add PEPE pct=-10 mcap=1000000

# Check recent hot list alerts
/alerts
```

## Trigger Configuration

### Long List Triggers

1. **Retracement** (Default: 15%)
   - Fires when price drops 15% from 72-hour high
   - 2-hour cooldown between alerts

2. **Momentum Stall** (Default: volume -30%, price ±5%)
   - Triggers when 24h volume drops 30% from previous 24h
   - AND price stays within 5% band over last 12h

3. **Breakout** (Default: +12% price, 1.5x volume)
   - Activates on 12% price increase from 12h baseline
   - Requires 1.5x volume increase confirmation

4. **Market Cap** (Default: OFF)
   - Custom levels like "300000,1000000"
   - First-touch logic (fires once per level)

### Hot List Triggers

1. **Percentage Targets**
   - Positive: +10% means "alert when price goes up 10%"
   - Negative: -5% means "alert when price goes down 5%"
   - One-shot: removes trigger after firing

2. **Market Cap Targets**
   - Comma-separated levels: "500000,1000000"
   - First-touch logic per level

3. **Failsafe (Always Active)**
   - Triggers at 60% drawdown from anchor price OR market cap
   - Does not remove coin from hot list

## Data Sources

- **Primary**: DexScreener API
- **Chains**: Solana-first, extensible to other chains
- **Rate Limits**: 300 requests/minute for pair data
- **Data**: Real-time price, volume, market cap, liquidity

## Architecture

```
src/
├── services/
│   ├── database.ts       # Prisma database layer
│   ├── dexscreener.ts   # API integration
│   ├── longlist.ts      # Long list logic
│   ├── hotlist.ts       # Hot list logic
│   ├── telegram.ts      # Bot commands & messaging
│   ├── scheduler.ts     # Cron jobs & timing
│   └── rateLimiter.ts   # Rate limiting & deduplication
├── types/               # TypeScript interfaces
├── utils/
│   ├── logger.ts        # Winston logging
│   ├── validation.ts    # Data validation & anomaly detection
│   └── errorHandler.ts  # Error recovery & circuit breakers
└── index.ts            # Application entry point
```

## Database Schema

The bot uses SQLite with Prisma ORM:

- **coin**: Token metadata and pair information
- **long_watch**: Long list membership and configuration
- **long_state**: Rolling price/volume state for triggers
- **hot_entry**: Hot list entries with anchor data
- **hot_trigger_state**: One-shot trigger state tracking
- **alert_history**: Historical alerts (hot list only)
- **schedule_cfg**: Global scheduling configuration
- **outbox**: Message delivery tracking

## Production Deployment

### Prerequisites
- Node.js 18+
- PM2 or systemd for process management
- Sufficient disk space for SQLite database and logs

### Systemd Service Example

```ini
[Unit]
Description=Follow Coin Bot
After=network.target

[Service]
Type=simple
User=bitcoin
WorkingDirectory=/home/bitcoin/follow-coin
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Monitoring

The bot includes built-in monitoring:

- **Logging**: Structured JSON logs with rotation
- **Health Checks**: Periodic status reporting in development
- **Error Tracking**: Automatic error categorization and recovery
- **Circuit Breakers**: Automatic service degradation on failures

### Backup Strategy

1. **Database**: SQLite file at `./data/bot.db`
2. **Logs**: Rotated files in `./logs/` directory
3. **Configuration**: Environment variables and Prisma schema

## Troubleshooting

### Common Issues

1. **Bot not responding**
   - Check TELEGRAM_BOT_TOKEN is correct
   - Verify bot was started with /start command
   - Check logs for authentication errors

2. **No price data**
   - Verify DexScreener API is accessible
   - Check rate limiting configuration
   - Look for validation errors in logs

3. **Missing alerts**
   - Verify cooldown periods haven't blocked alerts
   - Check trigger configuration for specific coins
   - Review rate limiting statistics

4. **Database errors**
   - Ensure DATABASE_URL path is writable
   - Run `npm run db:generate` after schema changes
   - Check disk space availability

### Log Levels

- **error**: Critical issues requiring attention
- **warn**: Important issues that don't stop operation
- **info**: Normal operational messages
- **debug**: Detailed debugging information (development only)

### Performance Tips

- Use WAL mode for SQLite in production
- Monitor API rate limits and adjust delays
- Regular database maintenance and log rotation
- Consider separating read/write operations for scaling

## Development

### Setup
```bash
npm install
npm run db:generate
cp .env.example .env
# Edit .env with development credentials
npm run dev
```

### Available Scripts
- `npm run dev` - Start in development mode
- `npm run build` - Compile TypeScript
- `npm run start` - Run compiled version
- `npm run lint` - Check code style
- `npm run db:studio` - Open Prisma database browser

### Testing
```bash
npm test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run linting and tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details.