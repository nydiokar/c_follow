#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function monitorEvents() {
    console.log('Monitoring incoming mint events for types and sources...\n');
    
    let lastId = 0;
    
    setInterval(async () => {
        try {
            const newEvents = await prisma.mintEvent.findMany({
                where: {
                    id: { gt: lastId }
                },
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    mint: true,
                    rawJson: true,
                    eventType: true
                }
            });
            
            for (const event of newEvents) {
                if (event.rawJson) {
                    const data = JSON.parse(event.rawJson);
                    console.log(`ID: ${event.id} | Mint: ${event.mint.slice(0, 8)}... | Type: ${data.type || 'NULL'} | Source: ${data.source || 'NULL'} | EventType: ${event.eventType || 'NULL'}`);
                    if (data.signature) {
                        console.log(`  Signature: ${data.signature}`);
                    }
                    if (data.description && data.description.length < 100) {
                        console.log(`  Description: ${data.description}`);
                    }
                }
                lastId = event.id;
            }
            
            if (newEvents.length > 0) {
                console.log(`--- Processed ${newEvents.length} new events ---\n`);
            }
        } catch (error) {
            console.error('Error:', error.message);
        }
    }, 5000); // Check every 5 seconds
}

monitorEvents().catch(console.error);