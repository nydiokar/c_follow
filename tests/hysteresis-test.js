// hysteresis-test.js - Test the hysteresis functionality
const { DatabaseService } = require('../dist/services/database');
const { DexScreenerService } = require('../dist/services/dexscreener');
const { LongListService } = require('../dist/services/longlist');
const { RollingWindowManager } = require('../dist/services/rollingWindow');
const { logger } = require('../dist/utils/logger');

// Mock time progression (to test cooldown periods)
const originalDateNow = Date.now;
let timeOffset = 0;

// Override Date.now for testing
Date.now = function() {
  return originalDateNow() + timeOffset;
};

function advanceTimeByHours(hours) {
  timeOffset += hours * 3600 * 1000;
  console.log(`Advanced time by ${hours} hours`);
  return Math.floor(Date.now() / 1000);
}

function resetTime() {
  timeOffset = 0;
  console.log('Reset time to current');
}

// Mock DexScreener for testing
function mockDexScreener() {
  const dexScreener = new DexScreenerService();
  
  // Override batchGetTokens to provide controlled test data
  dexScreener.batchGetTokens = async () => {
    const results = new Map();
    
    // For breakout testing, we need volume to be high enough
    const testVolume = testingBreakout ? 300000 : 500000;
    
    // Only return data for test coin
    results.set('solana:testTokenAddress', {
      chainId: 'solana',
      tokenAddress: 'testTokenAddress',
      symbol: 'TEST',
      name: 'Test Token',
      price: testPrice,  // Global var used to control price
      marketCap: 1000000,
      volume24h: testVolume,
      priceChange24h: 0,
      liquidity: 200000,
      lastUpdated: Date.now()
    });
    
    return results;
  };
  
  // Always return valid data
  dexScreener.validatePairData = () => true;
  
  return dexScreener;
}

// Global variables used by mock
let testPrice = 1.0;
let testingBreakout = false;

// Mock rolling window that always says warmup is complete
function mockRollingWindow() {
  const rollingWindow = new RollingWindowManager();
  
  rollingWindow.isWarmupComplete = async () => true;
  
  return rollingWindow;
}

async function testHysteresis() {
  console.log('Starting hysteresis test...');
  
  // Initialize services
  const db = new DatabaseService();
  await db.initialize();
  
  const dexScreener = mockDexScreener();
  const rollingWindow = mockRollingWindow();
  const longList = new LongListService(db, dexScreener, rollingWindow);
  
  try {
    // Test 1: Set up test token if needed
    console.log('\n--- Test 1: Setting up test token ---');
    
    let coins = await db.getLongListCoins();
    let testCoin = coins.find(c => c.symbol === 'TEST');
    
    if (!testCoin) {
      console.log('Creating test coin...');
      
      // Directly insert a test coin
      const coinId = await db.prisma.coin.create({
        data: {
          chain: 'solana',
          tokenAddress: 'testTokenAddress',
          symbol: 'TEST',
          name: 'Test Token',
          isActive: true
        }
      });
      
      // Create long watch entry
      await db.prisma.longWatch.create({
        data: {
          coinId: coinId.coinId,
          addedAtUtc: Math.floor(Date.now() / 1000),
          retraceOn: true,
          stallOn: true,
          breakoutOn: true,
          mcapOn: false,
          retracePct: 15.0,
          stallVolPct: 30.0,
          stallBandPct: 5.0,
          breakoutPct: 12.0,
          breakoutVolX: 1.5
        }
      });
      
      // Create long state entry with initial test values
      await db.prisma.longState.create({
        data: {
          coinId: coinId.coinId,
          h12High: 1.2,
          h24High: 1.3, 
          h72High: 1.5,
          h12Low: 0.9,
          h24Low: 0.8,
          h72Low: 0.7,
          v12Sum: 200000,
          v24Sum: 400000,
          lastUpdatedUtc: Math.floor(Date.now() / 1000)
        }
      });
      
      console.log(`Test coin created with ID: ${coinId.coinId}`);
      
      coins = await db.getLongListCoins();
      testCoin = coins.find(c => c.symbol === 'TEST');
    }
    
    console.log('Test coin:', testCoin);
    
    // Reset the database state to have clean test conditions
    await db.prisma.longState.update({
      where: { coinId: testCoin.coinId },
      data: {
        h12High: 1.2,
        h24High: 1.3, 
        h72High: 1.5,
        h12Low: 0.9,
        h24Low: 0.8,
        h72Low: 0.7,
        v12Sum: 200000,
        v24Sum: 400000,
        lastUpdatedUtc: Math.floor(Date.now() / 1000),
        lastRetraceFireUtc: null,
        lastStallFireUtc: null,
        lastBreakoutFireUtc: null,
        lastMcapFireUtc: null,
        lastRetracePrice: null,
        lastBreakoutPrice: null,
        lastStallPrice: null
      }
    });
    
    // Test 2: Test retrace trigger
    console.log('\n--- Test 2: Testing retrace trigger ---');
    testPrice = 1.0; // 33% drop from 72h high of 1.5
    
    // Get state before trigger
    const beforeState = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    console.log('State before retrace trigger:', beforeState);
    
    const retraceTriggers = await longList.checkTriggers();
    console.log(`Found ${retraceTriggers.length} retrace triggers:`, JSON.stringify(retraceTriggers, null, 2));
    
    if (retraceTriggers.length > 0 && retraceTriggers[0].triggerType === 'retrace') {
      console.log('PASS: Retrace trigger fired correctly');
    } else {
      console.log('FAIL: Retrace trigger did not fire');
    }
    
    // Check the database to verify the price was recorded
    const stateAfterRetrace = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    console.log('State after retrace trigger:', stateAfterRetrace);
    
    if (stateAfterRetrace.lastRetracePrice === 1.0) {
      console.log('PASS: Retrace price was correctly recorded');
    } else {
      console.log('FAIL: Retrace price was not recorded correctly');
    }
    
    // Test 3: Test breakout trigger with hysteresis
    console.log('\n--- Test 3: Testing breakout with sufficient hysteresis ---');

    // Get current state after retrace trigger
    const stateBeforeBreakoutTest = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    console.log('State before breakout test:', stateBeforeBreakoutTest);
    
    // First, change only to a price that won't trigger breakout but reset conditions
    testPrice = 1.15; // Not high enough for breakout 
    advanceTimeByHours(3); // Move past cooldown
    await longList.checkTriggers(); // Just to update state
    
    // Update the test data to make a clean breakout test possible
    await db.prisma.longState.update({
      where: { coinId: testCoin.coinId },
      data: {
        h12High: 1.2, // Set this so breakout threshold is 1.2 * 1.12 = 1.344
        lastUpdatedUtc: Math.floor(Date.now() / 1000)
      }
    });
    
    // Get state before breakout attempt
    const beforeBreakout = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    console.log('State before breakout attempt:', beforeBreakout);
    console.log(`Breakout threshold: ${beforeBreakout.h12High * 1.12}`);
    console.log(`Hysteresis threshold: ${beforeBreakout.lastRetracePrice * 1.3}`);
    
    // Test with a price that meets both breakout and hysteresis criteria
    testPrice = 1.5; // Higher than both thresholds
    testingBreakout = true; // Signal to use higher volume
    
    const breakoutTriggers = await longList.checkTriggers();
    console.log(`Found ${breakoutTriggers.length} breakout triggers`);
    
    if (breakoutTriggers.length > 0 && breakoutTriggers[0].triggerType === 'breakout') {
      console.log('PASS: Breakout trigger fired correctly');
      console.log(JSON.stringify(breakoutTriggers, null, 2));
    } else {
      console.log('FAIL: Breakout trigger did not fire');
    }
    
    // Check if price was recorded
    const stateAfterBreakout = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    console.log('State after breakout attempt:', stateAfterBreakout);
    
    if (stateAfterBreakout.lastBreakoutPrice === 1.4) {
      console.log('PASS: Breakout price was correctly recorded');
    } else {
      console.log('FAIL: Breakout price was not correctly recorded');
    }
    
    // Test 4: Check that another retrace requires hysteresis as well
    console.log('\n--- Test 4: Testing retrace after breakout ---');
    
    // Get current state after breakout
    const stateBeforeRetraceTest = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    console.log('State before retrace-after-breakout test:', stateBeforeRetraceTest);
    
    // First test with insufficient hysteresis
    testPrice = 1.25; // Not enough drop from breakout price
    advanceTimeByHours(3); // Bypass cooldown
    
    const beforeTest = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    
    if (beforeTest.lastBreakoutPrice) {
      console.log(`Hysteresis threshold for retrace: ${beforeTest.lastBreakoutPrice * 0.7}`);
      console.log(`Test price: ${testPrice}`);
    }
    
    const insufficientRetraceTriggers = await longList.checkTriggers();
    console.log(`Found ${insufficientRetraceTriggers.length} triggers with insufficient hysteresis`);
    
    if (insufficientRetraceTriggers.length === 0) {
      console.log('PASS: No retrace triggered when hysteresis requirement not met');
    } else {
      console.log('FAIL: Retrace triggered despite insufficient hysteresis');
      console.log(JSON.stringify(insufficientRetraceTriggers, null, 2));
    }
    
    // Now try with sufficient hysteresis
    testPrice = 0.9; // Large drop below breakout price
    
    const afterInsufficient = await db.prisma.longState.findFirst({
      where: { coinId: testCoin.coinId }
    });
    console.log('State before sufficient retrace test:', afterInsufficient);
    
    if (afterInsufficient.lastBreakoutPrice) {
      console.log(`Hysteresis threshold for retrace: ${afterInsufficient.lastBreakoutPrice * 0.7}`);
      console.log(`Test price: ${testPrice}`);
    }
    
    const sufficientRetraceTriggers = await longList.checkTriggers();
    console.log(`Found ${sufficientRetraceTriggers.length} retrace triggers with sufficient hysteresis`);
    
    if (sufficientRetraceTriggers.length > 0 && sufficientRetraceTriggers[0].triggerType === 'retrace') {
      console.log('PASS: Retrace trigger fired when hysteresis requirement met');
      console.log(JSON.stringify(sufficientRetraceTriggers, null, 2));
    } else {
      console.log('FAIL: Retrace trigger did not fire despite sufficient hysteresis');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    resetTime();
    await db.disconnect();
    console.log('\nTest completed');
  }
}

// Run the test
testHysteresis().catch(console.error);
