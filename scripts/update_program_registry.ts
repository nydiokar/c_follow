#!/usr/bin/env ts-node
/**
 * Program Registry Updater
 *
 * Extracts all unique program IDs from the database and updates the program registry.
 * - Keeps existing verified programs
 * - Adds new programs to pending_review
 * - Flags for GitHub PR if new programs found
 */

import { DatabaseManager } from '../src/utils/database';
import { logger } from '../src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface ProgramStats {
  programId: string;
  count: number;
  sources: string[];
  types: string[];
  sampleTx: string;
  firstSeen: number;
  lastSeen: number;
}

interface ProgramRegistry {
  version: string;
  description: string;
  last_updated: string;
  total_programs: number;
  verified_count: number;
  pending_count: number;
  categories: Record<string, any>;
  programs: Record<string, any>;
  pending_review: any[];
}

async function extractProgramsFromDatabase(): Promise<Map<string, ProgramStats>> {
  const prisma = DatabaseManager.getInstance() as any;
  const programStats = new Map<string, ProgramStats>();

  const events = await prisma.mint_event.findMany({
    select: { raw_json: true }
  });

  logger.info(`Processing ${events.length} events...`);

  for (const event of events) {
    try {
      const tx = JSON.parse(event.raw_json);
      const source = tx.source || 'UNKNOWN';
      const type = tx.type || 'UNKNOWN';
      const signature = tx.signature || '';
      const timestamp = tx.timestamp || 0;

      // Extract program IDs from instructions
      const programs = new Set<string>();
      if (tx.instructions && Array.isArray(tx.instructions)) {
        for (const ix of tx.instructions) {
          if (ix.programId) {
            programs.add(ix.programId);
          }
        }
      }

      // Update stats
      for (const pid of programs) {
        if (!programStats.has(pid)) {
          programStats.set(pid, {
            programId: pid,
            count: 0,
            sources: [],
            types: [],
            sampleTx: signature,
            firstSeen: timestamp,
            lastSeen: timestamp
          });
        }
        const stats = programStats.get(pid)!;
        stats.count++;
        if (!stats.sources.includes(source)) stats.sources.push(source);
        if (!stats.types.includes(type)) stats.types.push(type);
        stats.lastSeen = Math.max(stats.lastSeen, timestamp);
        stats.firstSeen = Math.min(stats.firstSeen, timestamp);
      }
    } catch (error) {
      // Skip invalid JSON
    }
  }

  return programStats;
}

async function updateRegistry(programStats: Map<string, ProgramStats>): Promise<{
  newPrograms: number;
  needsReview: boolean;
}> {
  const registryPath = path.join(__dirname, '../src/data/program_registry.json');

  // Load existing registry
  let registry: ProgramRegistry;
  if (fs.existsSync(registryPath)) {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  } else {
    throw new Error('Registry file not found. Run initial setup first.');
  }

  const existingPrograms = new Set([
    ...Object.keys(registry.programs),
    ...registry.pending_review.map((p: any) => p.programId)
  ]);

  const newPrograms: any[] = [];

  // Check for new programs
  for (const [pid, stats] of programStats) {
    if (!existingPrograms.has(pid)) {
      newPrograms.push({
        programId: pid,
        count: stats.count,
        sources: stats.sources,
        sample_tx: stats.sampleTx,
        solscan_url: `https://solscan.io/account/${pid}`,
        status: 'pending_review',
        detected_at: new Date().toISOString()
      });
    } else {
      // Update count for existing programs
      if (registry.programs[pid]) {
        registry.programs[pid].count = stats.count;
      }
      const pendingIndex = registry.pending_review.findIndex((p: any) => p.programId === pid);
      if (pendingIndex >= 0) {
        registry.pending_review[pendingIndex].count = stats.count;
      }
    }
  }

  // Add new programs to pending_review
  if (newPrograms.length > 0) {
    registry.pending_review.push(...newPrograms);
    registry.pending_review.sort((a, b) => b.count - a.count);
  }

  // Update metadata
  registry.version = new Date().toISOString().split('T')[0];
  registry.last_updated = new Date().toISOString();
  registry.total_programs = programStats.size;
  registry.verified_count = Object.keys(registry.programs).length;
  registry.pending_count = registry.pending_review.length;

  // Save updated registry
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

  logger.info(`Registry updated: ${newPrograms.length} new programs detected`);

  return {
    newPrograms: newPrograms.length,
    needsReview: newPrograms.length > 0
  };
}

async function main() {
  try {
    logger.info('Starting program registry update...');

    await DatabaseManager.initialize();

    const programStats = await extractProgramsFromDatabase();
    logger.info(`Extracted ${programStats.size} unique programs`);

    const result = await updateRegistry(programStats);

    if (result.needsReview) {
      logger.warn(`⚠️  ${result.newPrograms} new programs need review!`);
      logger.warn('Run: cat src/data/program_registry.json | jq .pending_review');
      process.exit(1); // Exit with error to trigger GitHub Action alert
    } else {
      logger.info('✅ No new programs detected');
      process.exit(0);
    }
  } catch (error) {
    logger.error('Failed to update registry:', error);
    process.exit(1);
  } finally {
    await DatabaseManager.disconnect();
  }
}

if (require.main === module) {
  main();
}

export { extractProgramsFromDatabase, updateRegistry };
