"""Website runtime configuration."""
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class WebConfig:
    def __init__(self, data_dir=None, public_url=None):
        self.data_dir = Path(data_dir or os.environ.get('HELIX_DATA_DIR', ROOT / 'scratch' / 'web-data')).resolve()
        self.public_url = str(public_url or os.environ.get('PUBLIC_URL', 'http://localhost:8000')).rstrip('/')
        parsed = urlsplit(self.public_url)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            raise ValueError('PUBLIC_URL 必须是完整的网站地址')
        self.secure = parsed.scheme == 'https'
        self.max_upload_bytes = int(os.environ.get('HELIX_MAX_UPLOAD_MB', '30')) * 1024 * 1024
        self.rate_limit_enabled = os.environ.get('HELIX_RATE_LIMIT', '1') != '0'
        self.compute_concurrency = int(os.environ.get('HELIX_COMPUTE_CONCURRENCY', '2'))
        self.smtp = {name: os.environ.get('SMTP_' + name, '') for name in ('HOST', 'PORT', 'USER', 'PASSWORD', 'FROM', 'TLS')}

