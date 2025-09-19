#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class DatabaseBackup {
  constructor() {
    this.backupDir = path.join(process.cwd(), 'backups');
    this.databasePath = process.env.DATABASE_URL?.replace('file:', '') || './data/bot.db';
    this.maxBackups = parseInt(process.env.MAX_BACKUPS || '2'); // Keep 2 days of backups
    this.compressionLevel = process.env.COMPRESSION_LEVEL || '6'; // 0-9, higher = more compression
  }

  async ensureBackupDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      console.log(`Created backup directory: ${this.backupDir}`);
    }
  }

  async createBackup() {
    try {
      await this.ensureBackupDirectory();
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `bot-backup-${timestamp}.db`;
      const backupPath = path.join(this.backupDir, backupName);
      
      // Create backup using SQLite's backup command for integrity
      const backupCommand = `sqlite3 "${this.databasePath}" "VACUUM INTO '${backupPath}'"`;
      
      console.log(`Creating backup: ${backupName}`);
      await execAsync(backupCommand);
      
      // Compress the backup
      const compressedPath = `${backupPath}.gz`;
      const compressCommand = `gzip -${this.compressionLevel} "${backupPath}"`;
      
      console.log(`Compressing backup...`);
      await execAsync(compressCommand);
      
      // Remove uncompressed backup
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      
      const finalSize = fs.statSync(compressedPath).size;
      const sizeMB = (finalSize / (1024 * 1024)).toFixed(2);
      
      console.log(`✓ Backup created successfully: ${backupName}.gz (${sizeMB} MB)`);
      
      // Clean up old backups
      await this.cleanupOldBackups();
      
      return compressedPath;
    } catch (error) {
      console.error('❌ Backup failed:', error.message);
      throw error;
    }
  }

  async cleanupOldBackups() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(file => file.endsWith('.db.gz'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          mtime: fs.statSync(path.join(this.backupDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > this.maxBackups) {
        const toDelete = files.slice(this.maxBackups);
        console.log(`Cleaning up ${toDelete.length} old backups...`);
        
        for (const file of toDelete) {
          fs.unlinkSync(file.path);
          console.log(`Deleted: ${file.name}`);
        }
      }
    } catch (error) {
      console.error('Warning: Could not cleanup old backups:', error.message);
    }
  }

  async restoreBackup(backupFile) {
    try {
      const backupPath = path.join(this.backupDir, backupFile);
      
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupFile}`);
      }

      // Decompress backup
      const decompressCommand = `gunzip -c "${backupPath}" > "${backupPath.replace('.gz', '')}"`;
      await execAsync(decompressCommand);
      
      const decompressedPath = backupPath.replace('.gz', '');
      
      // Create restore command
      const restoreCommand = `sqlite3 "${this.databasePath}" ".restore '${decompressedPath}'"`;
      
      console.log(`Restoring from backup: ${backupFile}`);
      await execAsync(restoreCommand);
      
      // Clean up decompressed file
      fs.unlinkSync(decompressedPath);
      
      console.log('✓ Database restored successfully');
    } catch (error) {
      console.error('❌ Restore failed:', error.message);
      throw error;
    }
  }

  async listBackups() {
    try {
      await this.ensureBackupDirectory();
      
      const files = fs.readdirSync(this.backupDir)
        .filter(file => file.endsWith('.db.gz'))
        .map(file => {
          const filePath = path.join(this.backupDir, file);
          const stats = fs.statSync(filePath);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          
          return {
            name: file,
            size: `${sizeMB} MB`,
            date: stats.mtime.toISOString(),
            age: this.getAge(stats.mtime)
          };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      console.log('\nAvailable backups:');
      console.log('==================');
      
      if (files.length === 0) {
        console.log('No backups found');
        return;
      }

      files.forEach((file, index) => {
        console.log(`${index + 1}. ${file.name}`);
        console.log(`   Size: ${file.size} | Date: ${file.date} | Age: ${file.age}`);
      });
      
      console.log(`\nTotal backups: ${files.length}`);
      console.log(`Max backups to keep: ${this.maxBackups}`);
    } catch (error) {
      console.error('Error listing backups:', error.message);
    }
  }

  getAge(date) {
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else {
      return 'Just now';
    }
  }
}

// CLI interface
async function main() {
  const backup = new DatabaseBackup();
  const command = process.argv[2];

  try {
    switch (command) {
      case 'create':
        await backup.createBackup();
        break;
      case 'restore':
        const backupFile = process.argv[3];
        if (!backupFile) {
          console.error('Usage: node backup.js restore <backup-file>');
          process.exit(1);
        }
        await backup.restoreBackup(backupFile);
        break;
      case 'list':
        await backup.listBackups();
        break;
      case 'cleanup':
        await backup.cleanupOldBackups();
        break;
      default:
        console.log('Database Backup Tool');
        console.log('==================');
        console.log('Usage:');
        console.log('  node backup.js create     - Create a new backup');
        console.log('  node backup.js restore <file> - Restore from backup');
        console.log('  node backup.js list       - List available backups');
        console.log('  node backup.js cleanup    - Clean up old backups');
        console.log('');
        console.log('Environment variables:');
        console.log('  DATABASE_URL     - Database file path (default: ./data/bot.db)');
        console.log('  MAX_BACKUPS      - Maximum backups to keep (default: 30)');
        console.log('  COMPRESSION_LEVEL - Gzip compression level 0-9 (default: 6)');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = DatabaseBackup;
