import json
import time
from typing import Any, List, Optional

import redis

from config import settings


class RedisQueueService:
    """
    Distributed queue primitives backed by Redis.

    - `WAIT_KEY` is a sorted set of ready-to-run job ids. The score encodes
      priority (1=highest ... 10=lowest) in the high-order digits and
      submission time in the low-order digits, so ZPOPMIN always returns the
      highest-priority, oldest-submitted job first. Requeued/reassigned jobs
      can be pushed to the head of their priority bucket (offset 0).
    - `DELAYED_KEY` is a sorted set of job ids scored by the absolute Unix ms
      timestamp at which they become runnable (used for both the initial
      `delayMs` and exponential backoff retries). `promote_delayed()` moves
      due jobs from DELAYED_KEY into WAIT_KEY.
    - Postgres/SQLite (via SQLAlchemy) is the source of truth for job data;
      Redis only tracks queue membership/ordering and lease epochs.
    - `EVENTS_CHANNEL` is a Redis pub/sub channel used by worker subprocesses
      (which have no direct handle to the Socket.IO server living in the
      FastAPI process) to publish telemetry events that main.py relays to
      connected dashboards.
    """

    WAIT_KEY = "pq:wait"
    DELAYED_KEY = "pq:delayed"
    DELAYED_META_KEY = "pq:delayed:priority"
    EVENTS_CHANNEL = "pq:events"

    PRIORITY_BUCKET = 10 ** 13  # keeps each priority's timestamp offsets well separated

    # Atomically pops the single lowest-scored (highest-priority, oldest)
    # member of the wait queue. Implemented as a Lua script rather than
    # ZPOPMIN so this works on any Redis >= 2.6, not just Redis >= 5.
    _DEQUEUE_SCRIPT = """
        local job_id = redis.call('ZRANGE', KEYS[1], 0, 0)[1]
        if not job_id then
            return nil
        end
        redis.call('ZREM', KEYS[1], job_id)
        return job_id
    """

    # Atomic fencing-token check: rejects a stale worker's commit if the
    # Reaper has since bumped the epoch out from under it.
    _EPOCH_CHECK_SCRIPT = """
        local current = redis.call('GET', KEYS[1])
        if current == false then
            return 1
        end
        if tonumber(current) == tonumber(ARGV[1]) then
            return 1
        else
            return 0
        end
    """

    def __init__(self):
        if settings.REDIS_URL:
            self.client = redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                protocol=2,
            )
        else:
            self.client = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                decode_responses=True,
                protocol=2,
            )

    def ping(self) -> bool:
        try:
            return bool(self.client.ping())
        except Exception:
            return False

    # ─── Queueing ────────────────────────────────────────────────

    def _score(self, priority: int, head: bool = False) -> float:
        priority = max(1, min(10, int(priority or 5)))
        offset = 0 if head else int(time.time() * 1000)
        return priority * self.PRIORITY_BUCKET + offset

    def _push_wait(self, job_id: str, priority: int, head: bool = False):
        self.client.zadd(self.WAIT_KEY, {job_id: self._score(priority, head)})

    def enqueue_job(self, job_id: str, priority: int = 5, delay_ms: int = 0, head: bool = False):
        """Enqueues a job. `head=True` prepends it to its priority bucket
        (used when the Reaper reassigns a job from a crashed worker)."""
        if delay_ms and delay_ms > 0:
            self.enqueue_delayed(job_id, priority, delay_ms)
        else:
            self._push_wait(job_id, priority, head=head)

    def enqueue_delayed(self, job_id: str, priority: int, delay_ms: int):
        run_at_ms = int(time.time() * 1000) + max(0, int(delay_ms))
        self.client.zadd(self.DELAYED_KEY, {job_id: run_at_ms})
        self.client.hset(self.DELAYED_META_KEY, job_id, priority)

    def promote_delayed(self) -> List[str]:
        """Moves any delayed jobs whose run_at has passed into the wait queue."""
        now_ms = int(time.time() * 1000)
        due = self.client.zrangebyscore(self.DELAYED_KEY, 0, now_ms)
        promoted = []
        for job_id in due:
            if self.client.zrem(self.DELAYED_KEY, job_id):
                priority_raw = self.client.hget(self.DELAYED_META_KEY, job_id)
                priority = int(priority_raw) if priority_raw else 5
                self.client.hdel(self.DELAYED_META_KEY, job_id)
                self._push_wait(job_id, priority, head=False)
                promoted.append(job_id)
        return promoted

    def dequeue_job(self) -> Optional[str]:
        """Atomically pops the highest-priority, oldest job id (or None)."""
        return self.client.eval(self._DEQUEUE_SCRIPT, 1, self.WAIT_KEY)

    def remove_from_queues(self, job_id: str):
        self.client.zrem(self.WAIT_KEY, job_id)
        self.client.zrem(self.DELAYED_KEY, job_id)
        self.client.hdel(self.DELAYED_META_KEY, job_id)

    # ─── Fencing tokens (monotonic lease epochs) ────────────────────

    def claim_epoch(self, job_id: str) -> int:
        """Called by a worker when it starts processing a job. Ensures an
        epoch exists and returns the current value to be echoed back on
        completion for fencing."""
        epoch_key = f"job:epoch:{job_id}"
        self.client.setnx(epoch_key, 1)
        current = self.client.get(epoch_key)
        return int(current) if current else 1

    def bump_lease_epoch(self, job_id: str) -> int:
        """Called by the Reaper when it reclaims a job from a presumed-dead
        worker. Any in-flight completion from the old worker will now be
        rejected by validate_lease_epoch()."""
        epoch_key = f"job:epoch:{job_id}"
        pipe = self.client.pipeline()
        pipe.incr(epoch_key)
        results = pipe.execute()
        return int(results[0])

    def validate_lease_epoch(self, job_id: str, epoch: int) -> bool:
        result = self.client.eval(self._EPOCH_CHECK_SCRIPT, 1, f"job:epoch:{job_id}", epoch)
        return bool(result)

    def clear_epoch(self, job_id: str):
        self.client.delete(f"job:epoch:{job_id}")

    # ─── Cross-process telemetry ────────────────────────────────────

    def publish_event(self, event: str, data: Any):
        try:
            self.client.publish(self.EVENTS_CHANNEL, json.dumps({"event": event, "data": data}))
        except Exception:
            pass


redis_service = RedisQueueService()
