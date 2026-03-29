import { spawn } from "child_process";
import readline from "readline";

export class KataGoAnalysisEngine {
  constructor(options = {}) {
    this.executablePath = options.executablePath || "";
    this.modelPath = options.modelPath || "";
    this.configPath = options.configPath || "";
    this.additionalArgs = Array.isArray(options.additionalArgs) ? options.additionalArgs : [];
    this.startupGraceMs = Number(options.startupGraceMs || 400);
    this.defaultTimeoutMs = Number(options.defaultTimeoutMs || 12000);
    this.stderrPrefix = options.stderrPrefix || "[KataGo]";
    this.process = null;
    this.stdoutReader = null;
    this.stderrReader = null;
    this.pending = new Map();
    this.startPromise = null;
    this.state = "idle";
    this.lastError = null;
  }

  isConfigured() {
    return Boolean(this.executablePath && this.modelPath && this.configPath);
  }

  isReady() {
    return Boolean(this.process && this.state === "ready" && !this.process.killed);
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      ready: this.isReady(),
      state: this.state,
      lastError: this.lastError,
    };
  }

  async start() {
    if (this.isReady()) {
      return true;
    }

    if (!this.isConfigured()) {
      throw new Error("KataGo is not fully configured.");
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = new Promise((resolve, reject) => {
      const args = [
        "analysis",
        "-config",
        this.configPath,
        "-model",
        this.modelPath,
        ...this.additionalArgs,
      ];

      this.state = "starting";
      this.lastError = null;

      const child = spawn(this.executablePath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      let settled = false;
      let startupTimer = null;

      const cleanup = () => {
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
      };

      const failStart = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.lastError = error instanceof Error ? error.message : String(error);
        this.state = "stopped";
        this.process = null;
        reject(error);
      };

      child.once("error", (error) => {
        failStart(error);
      });

      child.once("exit", (code, signal) => {
        const error = new Error(
          `KataGo exited during startup (code ${code ?? "null"}, signal ${signal ?? "null"}).`
        );
        failStart(error);
      });

      this.attachProcess(child);

      startupTimer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.state = "ready";
        resolve(true);
      }, this.startupGraceMs);
    })
      .finally(() => {
        this.startPromise = null;
      });

    return this.startPromise;
  }

  attachProcess(child) {
    this.process = child;

    this.stdoutReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    this.stderrReader = readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    });

    this.stdoutReader.on("line", (line) => {
      this.handleStdoutLine(line);
    });

    this.stderrReader.on("line", (line) => {
      if (line.trim()) {
        console.warn(`${this.stderrPrefix} ${line}`);
      }
    });

    child.on("exit", (code, signal) => {
      const message =
        code === 0 && signal === null
          ? "KataGo exited cleanly."
          : `KataGo exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "null"}).`;
      this.lastError = message;
      this.state = "stopped";
      this.process = null;
      this.rejectAllPending(new Error(message));
    });
  }

  handleStdoutLine(line) {
    if (!line.trim()) {
      return;
    }

    let payload;

    try {
      payload = JSON.parse(line);
    } catch (error) {
      console.warn(
        `${this.stderrPrefix} Failed to parse stdout JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    if (payload.warning) {
      console.warn(`${this.stderrPrefix} ${payload.warning}`);
      return;
    }

    if (payload.error) {
      if (payload.id && this.pending.has(payload.id)) {
        const pending = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        clearTimeout(pending.timeoutId);
        pending.reject(new Error(payload.error));
        return;
      }

      console.warn(`${this.stderrPrefix} ${payload.error}`);
      return;
    }

    if (!payload.id || payload.isDuringSearch) {
      return;
    }

    const pending = this.pending.get(payload.id);

    if (!pending) {
      return;
    }

    this.pending.delete(payload.id);
    clearTimeout(pending.timeoutId);
    pending.resolve(payload);
  }

  rejectAllPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }

    this.pending.clear();
  }

  async analyze(query, options = {}) {
    if (!query || typeof query !== "object") {
      throw new Error("KataGo query must be an object.");
    }

    await this.start();

    if (!this.process?.stdin) {
      throw new Error("KataGo process is not available.");
    }

    const timeoutMs = Number(options.timeoutMs || this.defaultTimeoutMs);
    const queryId = String(query.id || createQueryId());
    const payload = { ...query, id: queryId };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(queryId);
        reject(new Error(`KataGo query timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(queryId, {
        resolve,
        reject,
        timeoutId,
      });

      try {
        this.process.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(queryId);
        reject(error);
      }
    });
  }

  async stop() {
    if (!this.process) {
      return;
    }

    const child = this.process;
    this.process = null;
    this.state = "stopped";

    if (this.stdoutReader) {
      this.stdoutReader.close();
      this.stdoutReader = null;
    }

    if (this.stderrReader) {
      this.stderrReader.close();
      this.stderrReader = null;
    }

    child.kill();
  }
}

function createQueryId() {
  return `katago-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
