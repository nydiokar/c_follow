/**
 * Long List Integration Test
 * 
 * This test simulates real-world conditions for the long list functionality:
 * 1. Adding a new coin
 * 2. Simulating price movements over time
 * 3. Testing all trigger types with hysteresis
 * 4. Verifying proper state tracking and updates
 */

const { DatabaseService } = require('../dist/services/database');
const { DexScreenerService } = require('../dist/services/dexscreener');
const { LongListService } = require('../dist/services/longlist');
const { RollingWindowManager } = require('../dist/services/rollingWindow');

// Control time for testing
let currentTime = Date.now();
const originalDateNow = Date.now;
Date.now = () => currentTime;

// Advance time by hours
function advanceHours(hours) {
  const hourMs = hours * 60 * 60 * 1000;
  currentTime += hourMs;
  console.log(`Advanced time by ${hours} hours to ${new Date(currentTime).toISOString()}`);
}

// Price and volume controller for test scenarios
class MarketSimulator {
  constructor(initialPrice, initialVolume) {
    this.price = initialPrice;
    this.volume = initialVolume;
    this.history = [{
      timestamp: currentTime,
      price: initialPrice,
      volume: initialVolume
    }];
  }
  
  // Change price by percentage
  changePrice(pctChange) {
    this.price = this.price * (1 + pctChange/100);
    console.log(`Price changed by ${pctChange}% to ${this.price.toFixed(6)}`);
    return this.price;
  }
  
  // Change volume by percentage
  changeVolume(pctChange) {
    this.volume = this.volume * (1 + pctChange/100);
    console.log(`Volume changed by ${pctChange}% to ${this.volume.toFixed(0)}`);
    return this.volume;
  }
  
  // Record current state
  recordState() {
    this.history.push({
      timestamp: currentTime,
      price: this.price,
      volume: this.volume
    });
  }
}

// Create a mock DexScreener service that returns controlled data
class TestDexScreener extends DexScreenerService {
  constructor(market) {
    super();
    this.market = market;
    this.testToken = {
      chainId: 'solana',
      tokenAddress: 'test-token-address',
      symbol: 'TEST',
      name: 'Test Token'
    };
  }
  
  // Override batch fetching
  async batchGetTokens() {
    const results = new Map();
    
    results.set(`${this.testToken.chainId}:${this.testToken.tokenAddress}`, {
      ...this.testToken,
      price: this.market.price,
      marketCap: this.market.price * 1000000,
      volume24h: this.market.volume,
      priceChange24h: 0,
      liquidity: this.market.volume * 0.2,
      info: {},
      lastUpdated: Date.now()
    });
    
    return results;
  }
  
  // Always return valid data for tests
  validatePairData() {
    return true;
  }
}

// Run the test scenarios
async function runTests() {
  console.log('Starting Long List integration test...');
  
  // Initialize services first
  const db = new DatabaseService();
  await db.initialize();
  
  // Clean up any existing test data
  console.log('🧹 Cleaning up existing test data...');
  try {
    // Delete any existing coins with TEST symbol
    await db.prisma?.coin.deleteMany({
      where: { symbol: 'TEST' }
    });
    console.log('✅ Cleaned up existing test data');
  } catch (error) {
    console.log('⚠️ No existing test data to clean up');
  }
  
  // Set up market conditions
  const market = new MarketSimulator(1.0, 500000);
  
  const dexScreener = new TestDexScreener(market);
  const rollingWindow = new RollingWindowManager();
  const longList = new LongListService(db, dexScreener, rollingWindow);
  
  try {
    // --- SCENARIO 1: Add new coin ---
    console.log('\n=== SCENARIO 1: Adding a new coin ===');
    console.log('Adding TEST token to long list...');
    
    await longList.addCoin('test-token-address');
    const coins = await db.getLongListCoins();
    const testCoin = coins.find(c => c.symbol === 'TEST');
    
    if (testCoin) {
      console.log('SUCCESS: TEST coin added to long list');
      console.log('Coin data:', testCoin);
    } else {
      console.log('FAILED: TEST coin not found after adding');
      return;
    }
    
    // --- SCENARIO 2: Warmup period ---
    console.log('\n=== SCENARIO 2: Warmup period check ===');
    
    // Add some initial data points
    for (let i = 0; i < 6; i++) {
      // Small price oscillation during warmup
      const priceChange = (Math.random() * 6) - 3; // -3% to +3%
      market.changePrice(priceChange);
      await rollingWindow.addDataPoint(testCoin.coinId, {
        timestamp: Math.floor(currentTime / 1000),
        price: market.price,
        volume: market.volume / 24, // Hourly volume
        marketCap: market.price * 1000000
      });
      advanceHours(2);
    }
    
    console.log('Checking triggers during warmup...');
    const warmupTriggers = await longList.checkTriggers();
    
    if (warmupTriggers.length === 0) {
      console.log('SUCCESS: No triggers fired during warmup period');
    } else {
      console.log('FAILED: Triggers fired during warmup period:', warmupTriggers);
    }
    
    // Complete warmup by adding enough data points
    console.log('Completing warmup period...');
    for (let i = 0; i < 6; i++) {
      const priceChange = (Math.random() * 4) - 2; // -2% to +2%
      market.changePrice(priceChange);
      await rollingWindow.addDataPoint(testCoin.coinId, {
        timestamp: Math.floor(currentTime / 1000),
        price: market.price,
        volume: market.volume / 24,
        marketCap: market.price * 1000000
      });
      advanceHours(2);
    }
    
    // --- SCENARIO 3: Retrace trigger ---
    console.log('\n=== SCENARIO 3: Retrace trigger test ===');
    
    // Get current state
    let states = await db.getLongStates();
    let state = states.find(s => s.coinId === testCoin.coinId);
    console.log('Current state before retrace:', {
      price: market.price,
      h72High: state.h72High,
      retracePct: testCoin.config.retracePct
    });
    
    // Calculate retrace threshold
    const retraceThreshold = state.h72High * (1 - testCoin.config.retracePct / 100);
    console.log(`Retrace threshold: ${retraceThreshold.toFixed(6)} (${testCoin.config.retracePct}% below h72High)`);
    
    // Simulate price drop
    console.log('Simulating price drop...');
    market.changePrice(-20); // 20% drop
    
    // Check for triggers
    const retraceTriggers = await longList.checkTriggers();
    
    if (retraceTriggers.length > 0 && retraceTriggers[0].triggerType === 'retrace') {
      console.log('SUCCESS: Retrace trigger fired:', retraceTriggers[0].message);
    } else {
      console.log('FAILED: No retrace trigger fired');
    }
    
    // Check if price was recorded correctly
    states = await db.getLongStates();
    state = states.find(s => s.coinId === testCoin.coinId);
    
    if (state.lastRetracePrice === market.price) {
      console.log('SUCCESS: Retrace price recorded correctly');
    } else {
      console.log(`FAILED: Retrace price not recorded correctly. Expected: ${market.price}, Got: ${state.lastRetracePrice}`);
    }
    
    // --- SCENARIO 4: Breakout trigger test ---
    console.log('\n=== SCENARIO 4: Breakout trigger test ===');
    
    // Advance time past cooldown
    advanceHours(3);
    
    // Test breakout conditions: price +12% vs 12h baseline AND volume 1.5x vs 12h
    console.log('Testing breakout conditions...');
    // Get current state to calculate required price dynamically
    const currentStates = await db.getLongStates();
    const currentState = currentStates.find(s => s.coinId === testCoin.coinId);
    const requiredPrice = currentState.h12High * (1 + testCoin.config.breakoutPct / 100);
    const currentPriceBreakout = market.price;
    const priceIncrease = ((requiredPrice - currentPriceBreakout) / currentPriceBreakout) * 100;
    console.log(`Current price: ${currentPriceBreakout}, 12h high: ${currentState.h12High}, Required: ${requiredPrice}, Need increase: ${priceIncrease.toFixed(1)}%`);
    market.changePrice(priceIncrease); // Exact increase needed
    market.changeVolume(100); // 100% volume increase to trigger breakout
    
    const breakoutTriggers = await longList.checkTriggers();
    
    if (breakoutTriggers.length > 0 && breakoutTriggers[0].triggerType === 'breakout') {
      console.log('SUCCESS: Breakout trigger fired:', breakoutTriggers[0].message);
    } else {
      console.log('FAILED: No breakout trigger fired');
    }
    
    // --- SCENARIO 5: Stall trigger ---
    console.log('\n=== SCENARIO 5: Stall trigger test ===');
    
    // Advance time past cooldown
    advanceHours(3);
    
    // Get current state
    states = await db.getLongStates();
    state = states.find(s => s.coinId === testCoin.coinId);
    
    // Simulate sideways price with volume drop
    console.log('Simulating sideways price with volume drop...');
    // Get current state to calculate target price dynamically
    const currentStatesStall = await db.getLongStates();
    const currentStateStall = currentStatesStall.find(s => s.coinId === testCoin.coinId);
    const midPrice = (currentStateStall.h12High + currentStateStall.h12Low) / 2;
    const currentPriceStall = market.price;
    const priceChange = ((midPrice - currentPriceStall) / currentPriceStall) * 100;
    console.log(`Current price: ${currentPriceStall}, 12h range: [${currentStateStall.h12Low}, ${currentStateStall.h12High}], Target mid-price: ${midPrice}, Need change: ${priceChange.toFixed(1)}%`);
    market.changePrice(priceChange); // Move to middle of 12h range
    market.changeVolume(-40); // 40% volume drop
    
    const stallTriggers = await longList.checkTriggers();
    
    if (stallTriggers.length > 0 && stallTriggers[0].triggerType === 'stall') {
      console.log('SUCCESS: Stall trigger fired:', stallTriggers[0].message);
    } else {
      console.log('FAILED: No stall trigger fired');
    }
    
    // --- SCENARIO 6: Generate anchor report ---
    console.log('\n=== SCENARIO 6: Anchor report generation ===');
    
    const report = await longList.generateAnchorReport();
    
    if (report.length > 0) {
      console.log('SUCCESS: Anchor report generated with entries:', report.length);
      console.log('Sample report entry:', report[0]);
    } else {
      console.log('FAILED: No entries in anchor report');
    }
    
    console.log('\nAll test scenarios completed!');
    
  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    // Restore original Date.now
    Date.now = originalDateNow;
    
    await db.disconnect();
    rollingWindow.stop();
  }
}

// Run the tests
runTests().catch(console.error);
