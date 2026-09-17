import { redisClient } from '../config/redis.js';

export class LeaseManager {
  private static LEASE_TTL_SECONDS = 3;

  /**
   * Acquires a lease for a job. Initializes lease_epoch if not present.
   * Returns current epoch and whether lease was acquired.
   */
  public static async acquireLease(jobId: string, workerId: string): Promise<{ acquired: boolean; epoch: number }> {
    const epochKey = `job:epoch:${jobId}`;
    const leaseKey = `job:lease:${jobId}`;

    // Get current epoch or default to 1
    let epochStr = await redisClient.get(epochKey);
    let epoch = epochStr ? parseInt(epochStr, 10) : 1;
    if (!epochStr) {
      await redisClient.set(epochKey, epoch.toString());
    }

    // Set lease with NX (only if key does not exist or matches worker)
    const currentHolder = await redisClient.get(leaseKey);
    if (!currentHolder || currentHolder === workerId) {
      await redisClient.set(leaseKey, workerId, 'EX', this.LEASE_TTL_SECONDS);
      return { acquired: true, epoch };
    }

    return { acquired: false, epoch };
  }

  /**
   * Renews heartbeat lease for an active worker if epoch still matches.
   */
  public static async renewLease(jobId: string, workerId: string, epoch: number): Promise<boolean> {
    const epochKey = `job:epoch:${jobId}`;
    const leaseKey = `job:lease:${jobId}`;

    const luaScript = `
      local currentEpoch = redis.call('GET', KEYS[1])
      if not currentEpoch or tonumber(currentEpoch) == tonumber(ARGV[1]) then
        redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
        return 1
      else
        return 0
      end
    `;

    const result = await redisClient.eval(
      luaScript,
      2,
      epochKey,
      leaseKey,
      epoch.toString(),
      workerId,
      this.LEASE_TTL_SECONDS.toString()
    );

    return result === 1;
  }

  /**
   * Atomically increments epoch and revokes worker lease upon failover.
   */
  public static async invalidateLeaseAndBumpEpoch(jobId: string): Promise<number> {
    const epochKey = `job:epoch:${jobId}`;
    const leaseKey = `job:lease:${jobId}`;

    const luaScript = `
      local nextEpoch = redis.call('INCR', KEYS[1])
      redis.call('DEL', KEYS[2])
      return nextEpoch
    `;

    const nextEpoch = await redisClient.eval(luaScript, 2, epochKey, leaseKey);
    return typeof nextEpoch === 'number' ? nextEpoch : parseInt(String(nextEpoch), 10);
  }

  /**
   * Atomically validates that the caller's epoch is current before allowing completion.
   * Prevents zombie workers from writing stale results.
   */
  public static async validateCompletion(jobId: string, epoch: number): Promise<boolean> {
    const epochKey = `job:epoch:${jobId}`;
    const leaseKey = `job:lease:${jobId}`;

    const luaScript = `
      local currentEpoch = redis.call('GET', KEYS[1])
      if not currentEpoch or tonumber(currentEpoch) == tonumber(ARGV[1]) then
        redis.call('DEL', KEYS[2])
        return 1
      else
        return 0
      end
    `;

    const result = await redisClient.eval(luaScript, 2, epochKey, leaseKey, epoch.toString());
    return result === 1;
  }
}
