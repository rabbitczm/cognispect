"""Small per-process limits for the local website and its reverse proxy."""
from collections import defaultdict, deque
import threading
import time


class RequestLimits:
    def __init__(self):
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key, count, window=60):
        current = time.monotonic()
        with self.lock:
            if len(self.hits) > 4096:
                self.hits = defaultdict(deque, {k:v for k,v in self.hits.items() if v and v[-1] > current-window})
            queue = self.hits[key]
            while queue and queue[0] <= current-window:
                queue.popleft()
            if len(queue) >= count:
                return False
            queue.append(current)
        return True
