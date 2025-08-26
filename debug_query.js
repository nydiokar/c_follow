const { PrismaClient } = require('@prisma/client');

async function debugQuery() {
  const prisma = new PrismaClient();
  const nowMs = Date.now();
  const cutoffMs = nowMs - 24 * 60 * 60 * 1000;

  console.log('Cutoff timestamp:', new Date(cutoffMs).toISOString());
  console.log('Cutoff BigInt:', BigInt(cutoffMs));

  // This is the EXACT query from mintReport.ts
  const rows = await prisma.mintEvent.findMany({
    where: {
      isFirst: true,
      timestamp: { gte: BigInt(cutoffMs) },
      OR: [
        { scamStatus: null },      // Unprocessed tokens
        { scamStatus: 'clean' }    // Previously marked clean tokens  
      ]
    },
    select: { mint: true, timestamp: true, processedAt: true, scamStatus: true }
  });

  console.log('Prisma query returned:', rows.length, 'rows');

  // Count by status
  const statusCounts = rows.reduce((acc, r) => {
    const status = r.scamStatus || 'null';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  console.log('Status breakdown:', statusCounts);
  
  // Show some sample records
  console.log('Sample records:');
  rows.slice(0, 5).forEach((r, i) => {
    console.log(`${i+1}. ${r.mint} - status: ${r.scamStatus || 'null'} - ts: ${new Date(Number(r.timestamp))}`);
  });

  await prisma.$disconnect();
}

debugQuery().catch(console.error);