from __future__ import annotations

import os
import sys
from pathlib import Path


def require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise SystemExit(f"{label} not found: {path}")
    return path


def require_dir(path: Path, label: str) -> Path:
    if not path.is_dir():
        raise SystemExit(f"{label} not found: {path}")
    return path


server_home = require_dir(
    Path(os.environ.get("KATAGO_SERVER_HOME", "/root/katago-server")).expanduser(),
    "katago-server home",
)
runtime_dir = require_dir(
    Path(os.environ.get("KATAGO_RUNTIME_DIR", str(server_home / "runtime"))).expanduser(),
    "KataGo runtime directory",
)
binary_path = require_file(
    Path(os.environ.get("KATAGO_BINARY_PATH", str(runtime_dir / "katago"))).expanduser(),
    "KataGo binary",
)
model_path = require_file(
    Path(
        os.environ.get(
            "KATAGO_MODEL_PATH",
            str(server_home / "g170e-b10c128-s1141046784-d204142634.bin.gz"),
        )
    ).expanduser(),
    "KataGo model",
)
config_path = require_file(
    Path(os.environ.get("KATAGO_CONFIG_PATH", str(server_home / "gtp_ahn_eigen.cfg"))).expanduser(),
    "KataGo config",
)
bot_name = os.environ.get("KATAGO_SERVER_BOT_NAME", "katago_gtp_bot")
port = int(os.environ.get("KATAGO_SERVER_PORT", "2718"))

sys.path.insert(0, str(server_home))

from get_bot_app import get_bot_app  # noqa: E402
from katago_gtp_bot import KataGTPBot  # noqa: E402


katago_cmd = [
    str(binary_path),
    "gtp",
    "-model",
    str(model_path),
    "-config",
    str(config_path),
]

print(f"katago-server home: {server_home}")
print(f"KataGo binary: {binary_path}")
print(f"KataGo model: {model_path}")
print(f"KataGo config: {config_path}")
print(f"Listening on port: {port}")

katago_gtp_bot = KataGTPBot(katago_cmd)
app = get_bot_app(name=bot_name, bot=katago_gtp_bot)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=port, debug=False)
