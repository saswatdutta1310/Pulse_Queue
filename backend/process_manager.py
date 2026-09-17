import os
import signal
import subprocess
import sys
from typing import Dict, Optional

WORKER_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker_process.py")


class ProcessManager:
    """Fleet controller for real OS worker processes (one per WorkerModel row)."""

    def __init__(self):
        self._procs: Dict[str, subprocess.Popen] = {}

    def spawn(self, worker_id: str, hostname: str) -> int:
        env = os.environ.copy()
        proc = subprocess.Popen(
            [sys.executable, WORKER_SCRIPT, "--id", worker_id, "--hostname", hostname],
            cwd=os.path.dirname(WORKER_SCRIPT),
            env=env,
        )
        self._procs[worker_id] = proc
        return proc.pid

    def kill(self, worker_id: str) -> Optional[int]:
        """Forcefully terminates the OS process backing this worker (chaos kill)."""
        proc = self._procs.pop(worker_id, None)
        if not proc:
            return None
        pid = proc.pid
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True,
                    check=False,
                )
            else:
                os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass
        return pid

    def shutdown_all(self):
        for worker_id in list(self._procs.keys()):
            self.kill(worker_id)


process_manager = ProcessManager()
