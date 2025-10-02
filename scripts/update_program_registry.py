#!/usr/bin/env python3
"""
Program Registry Updater (Fast Python version)

Extracts program IDs directly from SQLite, updates registry, sends Telegram notification.
Much faster than TypeScript/Prisma for bulk processing.
"""

import sqlite3
import json
import os
import sys
from datetime import datetime
from collections import defaultdict
import requests

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
REGISTRY_PATH = os.path.join(PROJECT_DIR, 'src/data/solana_program_registry.json')
DB_PATH = os.path.join(PROJECT_DIR, 'prisma/bot.db')
ENV_PATH = os.path.join(PROJECT_DIR, '.env')

def load_env():
    """Load environment variables from .env file"""
    env_vars = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key] = value.strip()
    return env_vars

def extract_programs_from_db():
    """Extract all unique program IDs from database"""
    print(f"[{datetime.now()}] Connecting to database...")

    db = sqlite3.connect(DB_PATH)
    cursor = db.cursor()

    program_stats = defaultdict(lambda: {
        'count': 0,
        'sources': set(),
        'types': set(),
        'sample_tx': None,
        'first_seen': None,
        'last_seen': None
    })

    print(f"[{datetime.now()}] Processing events...")
    cursor.execute('SELECT raw_json FROM mint_event')

    processed = 0
    for row in cursor:
        try:
            tx = json.loads(row[0])
            source = tx.get('source', 'UNKNOWN')
            tx_type = tx.get('type', 'UNKNOWN')
            signature = tx.get('signature', '')
            timestamp = tx.get('timestamp', 0)

            # Extract program IDs from instructions
            programs = set()
            for ix in tx.get('instructions', []):
                if 'programId' in ix:
                    programs.add(ix['programId'])

            # Update stats
            for pid in programs:
                stats = program_stats[pid]
                stats['count'] += 1
                stats['sources'].add(source)
                stats['types'].add(tx_type)
                if not stats['sample_tx']:
                    stats['sample_tx'] = signature
                if not stats['first_seen'] or timestamp < stats['first_seen']:
                    stats['first_seen'] = timestamp
                if not stats['last_seen'] or timestamp > stats['last_seen']:
                    stats['last_seen'] = timestamp

            processed += 1
            if processed % 10000 == 0:
                print(f"  Processed {processed} events...")

        except Exception as e:
            pass  # Skip invalid JSON

    db.close()
    print(f"[{datetime.now()}] Extracted {len(program_stats)} unique programs from {processed} events")

    return program_stats

def update_registry(program_stats):
    """Update registry with new programs"""
    print(f"[{datetime.now()}] Loading existing registry...")

    if not os.path.exists(REGISTRY_PATH):
        print(f"ERROR: Registry not found at {REGISTRY_PATH}")
        sys.exit(1)

    with open(REGISTRY_PATH) as f:
        registry = json.load(f)

    # Get existing programs
    existing_programs = set(registry['programs'].keys())
    existing_programs.update(p['programId'] for p in registry['pending_review'])

    # Find new programs
    new_programs = []
    for pid, stats in program_stats.items():
        if pid not in existing_programs:
            new_programs.append({
                'programId': pid,
                'count': stats['count'],
                'sources': list(stats['sources']),
                'sample_tx': stats['sample_tx'],
                'solscan_url': f'https://solscan.io/account/{pid}',
                'status': 'pending_review',
                'detected_at': datetime.now().isoformat()
            })
        else:
            # Update counts for existing programs
            if pid in registry['programs']:
                registry['programs'][pid]['count'] = stats['count']
            else:
                # Update in pending_review
                for p in registry['pending_review']:
                    if p['programId'] == pid:
                        p['count'] = stats['count']
                        break

    if new_programs:
        print(f"[{datetime.now()}] Found {len(new_programs)} new programs!")
        registry['pending_review'].extend(new_programs)
        registry['pending_review'].sort(key=lambda x: x['count'], reverse=True)
    else:
        print(f"[{datetime.now()}] No new programs detected")

    # Update metadata
    registry['version'] = datetime.now().strftime('%Y-%m-%d')
    registry['last_updated'] = datetime.now().isoformat()
    registry['total_programs'] = len(program_stats)
    registry['verified_count'] = len(registry['programs'])
    registry['pending_count'] = len(registry['pending_review'])

    # Save registry
    with open(REGISTRY_PATH, 'w') as f:
        json.dump(registry, f, indent=2)

    print(f"[{datetime.now()}] Registry updated")

    return len(new_programs), registry['pending_review']

def send_telegram_notification(new_count, pending_programs, env_vars):
    """Send Telegram notification with pending programs list"""
    bot_token = env_vars.get('TELEGRAM_BOT_TOKEN')
    chat_id = env_vars.get('TELEGRAM_CHAT_ID')

    if not bot_token or not chat_id:
        print(f"[{datetime.now()}] Telegram credentials not found - skipping notification")
        return

    # Build list of pending programs (top 20 to avoid message being too long)
    program_list = []
    for i, prog in enumerate(pending_programs[:20], 1):
        pid = prog['programId']
        count = prog['count']
        url = prog['solscan_url']
        program_list.append(f"{i}. [{pid[:8]}...]({url}) - {count:,} txs")

    programs_text = "\n".join(program_list)

    if len(pending_programs) > 20:
        programs_text += f"\n\n_...and {len(pending_programs) - 20} more_"

    message = f"""🔍 *Program Registry Update*

📊 *{new_count} new programs* detected
📋 *{len(pending_programs)} total* pending review

*Top programs to review:*
{programs_text}

After classifying, commit and push to GitHub."""

    try:
        url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
        data = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'Markdown',
            'disable_web_page_preview': True
        }
        response = requests.post(url, json=data)

        if response.ok:
            print(f"[{datetime.now()}] Telegram notification sent successfully")
        else:
            print(f"[{datetime.now()}] Failed to send Telegram notification: {response.text}")
    except Exception as e:
        print(f"[{datetime.now()}] Error sending Telegram notification: {e}")

def main():
    print(f"[{datetime.now()}] Starting program registry update...")

    # Load environment
    env_vars = load_env()

    # Extract programs
    program_stats = extract_programs_from_db()

    # Update registry
    new_count, pending_programs = update_registry(program_stats)

    # Send notification if new programs found
    if new_count > 0:
        send_telegram_notification(new_count, pending_programs, env_vars)

    print(f"[{datetime.now()}] Program registry update completed")
    sys.exit(0)

if __name__ == '__main__':
    main()
