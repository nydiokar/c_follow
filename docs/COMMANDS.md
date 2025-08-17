# Follow Coin Bot - Command Reference

## Overview

Follow Coin Bot provides a comprehensive set of Telegram commands for managing cryptocurrency tracking and alerts. The bot supports both long-term monitoring (Long List) and short-term alerts (Hot List) with extensive configuration options.

## Command Categories

### System Commands
- `/start` - Welcome message and system overview
- `/help` - Complete command reference

### Long List Commands (Long-term Monitoring)
- `/long_add` - Add coin to persistent monitoring
- `/long_rm` - Remove coin from long list
- `/long_trigger` - Toggle trigger types globally
- `/long_set` - Configure per-coin settings
- `/report_now` - Generate immediate anchor report

### Hot List Commands (Quick Alerts)
- `/hot_add` - Add coin for percentage-based alerts
- `/hot_rm` - Remove coin from hot list
- `/hot_list` - Show all hot list entries
- `/alerts` - View recent long list alerts

## Detailed Command Reference

### System Commands

#### `/start`
**Description:** Displays welcome message and system overview.

**Usage:**
```
/start
```

**Response:**
```
🚀 Follow Coin Bot - Active

This bot tracks cryptocurrency prices and sends intelligent alerts.

📊 Long List: Persistent monitoring with retracement, stall, and breakout detection
⚡ Hot List: Quick percentage-based alerts with market cap milestones

Use /help for complete command reference.

System Status: ✅ All services operational
Database: ✅ Connected
DexScreener API: ✅ Available
```

#### `/help`
**Description:** Shows complete command reference with examples.

**Usage:**
```
/help
```

**Response:** Complete command list with syntax and examples.

### Long List Commands

#### `/long_add <symbol>`
**Description:** Adds a cryptocurrency to long-term monitoring with default settings.

**Usage:**
```
/long_add <SYMBOL>
```

**Parameters:**
- `symbol`: Trading symbol (e.g., SOL, BTC, MEME)

**Examples:**
```
/long_add SOL
/long_add MEME
/long_add BONK
```

**Default Configuration:**
- Retracement alerts: 15% drop from 72h high
- Stall detection: 30% volume drop + 5% price compression
- Breakout alerts: 12% price increase + 1.5x volume
- Market cap alerts: Disabled by default

**Response on Success:**
```
✅ Added MEME to Long List

Default Settings:
🔴 Retrace: 15% (from 72h high)
⏸️ Stall: ON (30% vol drop, 5% band)
🚀 Breakout: 12% + 1.5x volume
💰 Market Cap: OFF

Current Price: $0.00012
Market Cap: $45,234

Use /long_set MEME to customize settings.
```

**Response on Error:**
```
❌ Failed to add MEME to Long List
Reason: Symbol not found on DexScreener

Please verify the symbol and try again.
```

#### `/long_rm <symbol>`
**Description:** Removes a cryptocurrency from long list monitoring.

**Usage:**
```
/long_rm <SYMBOL>
```

**Examples:**
```
/long_rm SOL
/long_rm MEME
```

**Response on Success:**
```
✅ Removed MEME from Long List
All alerts for this coin have been disabled.
```

**Response on Error:**
```
❌ MEME not found in Long List
Use /long_add MEME to add it first.
```

#### `/long_trigger <type> <on|off>`
**Description:** Globally enables or disables specific trigger types for all long list coins.

**Usage:**
```
/long_trigger <TYPE> <on|off>
```

**Trigger Types:**
- `retrace` - Price retracement alerts
- `stall` - Stall detection alerts  
- `breakout` - Breakout momentum alerts
- `mcap` - Market cap milestone alerts

**Examples:**
```
/long_trigger retrace off
/long_trigger breakout on
/long_trigger stall off
/long_trigger mcap on
```

**Response:**
```
✅ Retrace alerts: DISABLED globally

This affects all coins in Long List:
- SOL: Retrace disabled
- MEME: Retrace disabled  
- BONK: Retrace disabled

Individual coin settings preserved.
Use /long_trigger retrace on to re-enable.
```

#### `/long_set <symbol> <param>=<value> [param2=value2...]`
**Description:** Configures specific trigger settings for a coin in the long list.

**Usage:**
```
/long_set <SYMBOL> <parameter>=<value> [additional parameters...]
```

**Parameters:**

##### Retracement Settings
- `retrace=<percentage>` - Set retracement percentage (5-50%)
- `retrace=on|off` - Enable/disable retracement alerts

##### Stall Settings  
- `stall=on|off` - Enable/disable stall detection
- `stall_vol=<percentage>` - Volume drop threshold (10-70%)
- `stall_band=<percentage>` - Price compression band (1-15%)

##### Breakout Settings
- `breakout=<percentage>` - Price increase threshold (5-50%)
- `breakout_vol=<multiplier>` - Volume multiplier (1.0-5.0)
- `breakout=on|off` - Enable/disable breakout alerts

##### Market Cap Settings
- `mcap=on|off` - Enable/disable market cap alerts
- `mcap=<level1,level2,level3>` - Set milestone levels

**Examples:**
```
/long_set MEME retrace=20
/long_set SOL breakout=15 breakout_vol=2.0
/long_set BONK stall=off retrace=25
/long_set MEME mcap=100000,500000,1000000
/long_set SOL retrace=18 breakout=14 stall_vol=25
```

**Response:**
```
✅ Updated MEME settings:

🔴 Retrace: 20% (was 15%)
⏸️ Stall: ON (30% vol, 5% band)
🚀 Breakout: 12% + 1.5x volume  
💰 Market Cap: 100K, 500K, 1M

Current Price: $0.00015 (+25% from entry)
Next retrace alert at: $0.00012 (-20%)
```

#### `/report_now`
**Description:** Forces immediate generation of anchor report showing current status of all long list coins.

**Usage:**
```
/report_now
```

**Response:**
```
📊 Long List Anchor Report
Generated: 2024-12-15 14:30 UTC

🟢 SOL - $98.45 (+2.3% 24h)
   72h High: $101.20 | Retrace at: $86.02
   Volume: $2.1B (normal) | MCap: $45.8B

🟡 MEME - $0.00015 (+156% 24h) 
   72h High: $0.00018 | Retrace at: $0.00014
   Volume: $890K (3.2x avg) | MCap: $78K
   
🔴 BONK - $0.0000089 (-8.5% 24h)
   72h High: $0.0000098 | Retrace at: $0.0000084
   Volume: $12M (0.6x avg) | MCap: $567M

📈 3 coins monitored | 2 trending up | 1 retracing
⚡ Next automated report: 20:00 UTC
```

### Hot List Commands

#### `/hot_add <symbol> [pct=±X] [mcap=X,Y,Z]`
**Description:** Adds a cryptocurrency to hot list for quick percentage-based alerts.

**Usage:**
```
/hot_add <SYMBOL> [pct=±percentage] [mcap=level1,level2,level3]
```

**Parameters:**
- `symbol`: Trading symbol (required)
- `pct`: Percentage target (optional, default: +5%)
- `mcap`: Market cap milestone levels in USD (optional)

**Examples:**
```
/hot_add MEME
/hot_add SOL pct=25
/hot_add BONK pct=-15
/hot_add NEWCOIN pct=50 mcap=100000,500000,1000000
/hot_add PUMP mcap=1000000,5000000
```

**Response:**
```
⚡ Added MEME to Hot List

Anchor Price: $0.00012
Anchor MCap: $56,789
Target: +25% → $0.00015
MCap Milestones: $100K, $500K, $1M

🛡️ Failsafe: -60% ($0.000048)

Alert will trigger when price hits target or failsafe.
Use /hot_rm MEME to remove.
```

#### `/hot_rm <symbol>`
**Description:** Removes a cryptocurrency from hot list monitoring.

**Usage:**
```
/hot_rm <SYMBOL>
```

**Examples:**
```
/hot_rm MEME
/hot_rm SOL
```

**Response:**
```
✅ Removed MEME from Hot List
Target: +25% at $0.00015 (not reached)
All hot alerts for this coin disabled.
```

#### `/hot_list`
**Description:** Shows all active hot list entries with current status.

**Usage:**
```
/hot_list
```

**Response:**
```
⚡ Hot List Status (3 active)

🟢 MEME - $0.00015 (+25% ✅)
   Anchor: $0.00012 | Target: +25% REACHED
   MCap: $78K → $100K (next milestone)
   
🟡 SOL - $99.12 (+1.2%)  
   Anchor: $98.00 | Target: +25% → $122.50
   Progress: 5% of target reached
   
🔴 BONK - $0.0000084 (-12%)
   Anchor: $0.0000095 | Target: -15% → $0.0000081
   Failsafe: -60% at $0.0000038

📊 1 target hit | 2 pending | 0 failsafes triggered
```

#### `/alerts`
**Description:** Shows current long list monitoring status (MCap, Volume, 72H High, Contract Address).

**Usage:**
```
/alerts [count]
```

**Parameters:**
- `count`: Number of alerts to show (optional, default: 10, max: 50)

**Examples:**
```
/alerts
/alerts 20
```

**Response:**
```
📊 Long List Monitoring Status

*TEST (Test Token)*
   🔗 CA: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`
   📊 MCap: $1.0M
   📈 24h Vol: 500.0K (📈 +25.0%)
   📉 From 72h High: -5.0%

*SOL (Solana)*
   🔗 CA: `So11111111111111111111111111111111111111112`
   📊 MCap: $45.2B
   📈 24h Vol: 2.1B (📉 -5.2%)
   📉 From 72h High: -2.1%
```

## Advanced Usage

### Batch Configuration

#### Multiple Long List Settings
```
/long_set MEME retrace=20 breakout=15 stall=off
/long_set SOL mcap=50000000,75000000,100000000
/long_set BONK retrace=25 breakout_vol=2.5
```

#### Multiple Hot List Entries
```
/hot_add MEME pct=25 mcap=100000,500000
/hot_add SOL pct=15
/hot_add BONK pct=-20
```

### Configuration Examples

#### Conservative Long List Setup
```
/long_add BTC
/long_set BTC retrace=10 breakout=8 stall_vol=20
```

#### Aggressive Meme Coin Tracking
```
/long_add MEME
/long_set MEME retrace=30 breakout=25 breakout_vol=3.0
/hot_add MEME pct=100 mcap=100000,1000000,10000000
```

#### Portfolio Monitoring
```
/long_add SOL
/long_add ETH  
/long_add BTC
/long_trigger mcap on
/long_set SOL mcap=50000000,75000000,100000000
/long_set ETH mcap=300000000,400000000,500000000
```

## Response Formats

### Success Responses
All successful commands include:
- ✅ Confirmation message
- Current coin status
- Relevant configuration details
- Next steps or related commands

### Error Responses
Error responses include:
- ❌ Clear error indicator
- Specific reason for failure
- Suggested corrective actions
- Related command suggestions

### Alert Formats

#### Retracement Alert
```
🔴 SOL RETRACEMENT -15.2%
$101.20 → $85.80 (-15.2% from 72h high)

Volume: $1.8B (normal)
Support: $82.50 | Resistance: $95.00

Added to watchlist 3 days ago
```

#### Breakout Alert
```
🚀 MEME BREAKOUT +18.5%
$0.00012 → $0.000142 (+18.5% from 12h high)

Volume: 3.2x average (breakout confirmed)
Resistance broken: $0.000135
Next level: $0.000165

Momentum: Strong ⬆️
```

#### Hot List Alert
```
⚡ PUMP +50% TARGET HIT
$0.025 → $0.0375 (+50.0% from anchor)

Entry: $0.025 (2 hours ago)
Market Cap: $1.2M (+50%)
Next milestone: $2M market cap

🎯 Target reached in 2h 15m
```

#### Failsafe Alert
```
🛡️ DUMP FAILSAFE TRIGGERED -60.2%
$0.050 → $0.0199 (-60.2% from anchor)

⚠️ Emergency exit suggested
Original entry: $0.050 (6 hours ago)
Max gain reached: +25% at $0.0625

Risk management alert - consider position
```

## Command Validation

### Input Validation
- Symbol format checking
- Parameter range validation
- Required parameter verification
- Type checking for numeric values

### Error Prevention
- Duplicate entry detection
- Configuration conflict resolution
- Resource availability checking
- Rate limiting compliance

### User Feedback
- Clear success/error messaging
- Actionable error descriptions
- Configuration confirmation
- Status updates

## Rate Limiting

### Command Frequency
- Maximum 10 commands per minute per user
- Bulk operations limited to prevent spam
- Alert generation throttled by cooldown periods

### Alert Cooldowns
- Long List: 2 hours between duplicate alerts
- Hot List: No cooldown (different trigger logic)
- System alerts: 5 minutes between similar messages

## Security Features

### Input Sanitization
- SQL injection prevention
- Command injection blocking
- Parameter validation
- Output escaping

### Access Control
- Chat ID verification
- Command authorization
- Rate limiting enforcement
- Error information limiting

This command reference provides comprehensive guidance for using all bot features effectively. For technical implementation details, see the API Documentation.