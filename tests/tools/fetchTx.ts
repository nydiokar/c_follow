import axios, { AxiosInstance } from 'axios';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

type Json = Record<string, unknown>;

function getApiKey(): string {
  const apiKey: string | undefined = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || process.env.HELIUS_TOKEN;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error('Missing HELIUS_API_KEY in environment');
    process.exit(1);
  }
  return apiKey;
}

function parseArgs(argv: string[]): { signatures: string[]; outPath?: string } {
  const args = argv.slice(2);
  const signatures: string[] = [];
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg: string | undefined = args[i];
    if (!arg) continue;
    if (arg === '--out') {
      const nextVal: string | undefined = args[i + 1];
      if (typeof nextVal === 'string' && !nextVal.startsWith('--')) {
        outPath = nextVal;
        i += 1;
      }
    } else if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
    } else if (arg.indexOf(',') !== -1) {
      signatures.push(...arg.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (!arg.startsWith('--')) {
      signatures.push(arg);
    }
  }
  if (signatures.length === 0) {
    // eslint-disable-next-line no-console
    console.error('Usage: npm run tx:fetch -- <signature[,signature2,...]> [--out <file|dir>]');
    process.exit(1);
  }
  const result: { signatures: string[]; outPath?: string } = { signatures };
  if (typeof outPath === 'string') {
    result.outPath = outPath;
  }
  return result;
}

function createClients(apiKey: string): { http: AxiosInstance } {
  const http = axios.create({ timeout: 20_000 });
  return { http };
}

async function fetchEnhanced(http: AxiosInstance, apiKey: string, signatures: string[]): Promise<Json[]> {
  const url = `https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`;
  const { data } = await http.post<Json[]>(url, { transactions: signatures });
  return data;
}

async function main(): Promise<void> {
  const { signatures, outPath } = parseArgs(process.argv);
  const apiKey = getApiKey();
  const { http } = createClients(apiKey);

  try {
    const enhanced = await fetchEnhanced(http, apiKey, signatures);

    // If a single signature and --out provided, write to that file
    if (signatures.length === 1 && outPath && outPath.endsWith('.json')) {
      const resolved = path.resolve(process.cwd(), outPath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, JSON.stringify(enhanced[0], null, 2), 'utf8');
      // eslint-disable-next-line no-console
      console.log(`Saved to ${resolved}`);
      return;
    }

    // Otherwise, write one file per signature to logs/tx-<sig>.json (simple)
    const baseDir = path.resolve(process.cwd(), outPath && !outPath.endsWith('.json') ? outPath : 'logs');
    await fs.mkdir(baseDir, { recursive: true });
    for (let i = 0; i < signatures.length; i += 1) {
      const sig: string | undefined = signatures[i];
      const enh = enhanced[i];
      if (!sig || !enh) continue;
      const safe = sig.replace(/[^A-Za-z0-9_-]/g, '');
      const file = path.join(baseDir, `tx-${safe}.json`);
      await fs.writeFile(file, JSON.stringify(enh, null, 2), 'utf8');
      // eslint-disable-next-line no-console
      console.log(`Saved to ${file}`);
    }
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('Fetch failed', error?.response?.data || error?.message || error);
    process.exit(1);
  }
}

void main();


