import redis
import json
import uuid
from typing import Dict, Any, Optional
from config import settings

class RedisQueueService:
    def __init__(self):
        self.client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True
        )

    def ping(self) -> bool:
        try:
            return self.client.ping()
        except:
            return False

    def enqueue_job(self, job_id: str, job_type: str, payload: Dict[str, Any], priority: int = 5, delay_ms: int = 0):
        """
        Pushes job to BullMQ compatible format in Redis
        """
        queue_key = "bull:pulse-queue:wait"
        job_data_key = f"bull:pulse-queue:{job_id}"

        job_doc = {
            "name": job_type,
            "data": json.dumps(payload),
            "opts": json.dumps({"attempts": 3, "priority": priority, "delay": delay_ms}),
            "progress": "0",
            "delay": str(delay_ms),
            "timestamp": str(int(redis.time()[0] * 1000)),
            "attemptsMade": "0",
            "stacktrace": "[]"
        }

        self.client.hset(job_data_key, mapping=job_doc)

        if delay_ms > 0:
            delayed_key = "bull:pulse-queue:delayed"
            score = (redis.time()[0] * 1000) + delay_ms
            self.client.zadd(delayed_key, {job_id: score})
        else:
            self.client.lpush(queue_key, job_id)

    def bump_lease_epoch(self, job_id: str) -> int:
        """
        Atomically increments epoch and revokes worker lease (Fencing Token).
        """
        epoch_key = f"job:epoch:{job_id}"
        lease_key = f"job:lease:{job_id}"

        pipe = self.client.pipeline()
        pipe.incr(epoch_key)
        pipe.delete(lease_key)
        results = pipe.execute()
        return int(results[0])

    def validate_lease_epoch(self, job_id: str, epoch: int) -> bool:
        epoch_key = f"job:epoch:{job_id}"
        current = self.client.get(epoch_key)
        if not current:
            return True
        return int(current) == epoch

redis_service = RedisQueueService()
