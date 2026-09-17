import { LeaseManager } from '../src/services/leaseManager.js';
import { redisClient } from '../src/config/redis.js';

async function runTests() {
  console.log('🧪 [Test Suite] Running PulseQueue Distributed Primitives Verification...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  try {
    // 1. Redis connectivity test
    const ping = await redisClient.ping();
    assert(ping === 'PONG', 'Redis connection is operational');

    // 2. Lease Acquisition Test
    const testJobId = `job-test-${Date.now()}`;
    const worker1 = 'worker-test-1';
    const worker2 = 'worker-test-2';

    const lease1 = await LeaseManager.acquireLease(testJobId, worker1);
    assert(lease1.acquired === true, 'Worker 1 acquired initial lease');
    assert(lease1.epoch === 1, 'Initial lease epoch is 1');

    // 3. Competing Worker Lease Test
    const lease2 = await LeaseManager.acquireLease(testJobId, worker2);
    assert(lease2.acquired === false, 'Competing Worker 2 is rejected while lease is held');

    // 4. Lease Renewal Test
    const renewed = await LeaseManager.renewLease(testJobId, worker1, lease1.epoch);
    assert(renewed === true, 'Worker 1 successfully renewed active lease with current epoch');

    // 5. Failover Invalidation & Epoch Bump (Reaper Simulation)
    const newEpoch = await LeaseManager.invalidateLeaseAndBumpEpoch(testJobId);
    assert(newEpoch === 2, 'Reaper bumped fencing epoch from 1 to 2 upon simulated failover');

    // 6. Zombie Worker Rejection Test
    const zombieCompletion = await LeaseManager.validateCompletion(testJobId, 1); // Worker 1 with stale epoch 1
    assert(zombieCompletion === false, 'Zombie worker with stale epoch 1 is REJECTED by fencing token');

    // 7. Legitimate Worker Completion Test
    const legitimateCompletion = await LeaseManager.validateCompletion(testJobId, 2); // Rescued worker with epoch 2
    assert(legitimateCompletion === true, 'Rescued worker with epoch 2 is successfully accepted and validated');

    console.log(`\n📊 [Test Summary] Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (err: any) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
