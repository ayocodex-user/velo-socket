import net from "net";
import { exec } from "child_process";
import os from "os";

/**
 * Method 1: Try to bind to port
 * ✅ Reliable, but cannot show PID/process
 *
 * ⚠️ Not reliable: Binding may succeed even if another process is listening on a different interface,
 * or may fail for reasons other than the port being in use. Use with caution.
 */
export function checkPortByBind(port: number, host = "127.0.0.1"): Promise<{ inUse: boolean, pid: number | null, process: string | null }> {
  // This method is not reliable for checking port usage in all environments.
  // Prefer checkPortBySystem for more accurate results.
  return new Promise((resolve) => {
    // Try to create a server and listen on the port
    const server = net.createServer();

    let resolved = false;

    const cleanup = () => {
      server.removeAllListeners("error");
      server.removeAllListeners("listening");
    };

    server.once("error", (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        // EADDRINUSE means port is in use, but other errors may occur for other reasons
        if (err instanceof Error && (err as any).code === "EADDRINUSE") {
          resolve({ inUse: true, pid: null, process: null });
        } else {
          // Could be EACCES, EADDRNOTAVAIL, etc. Not always "not in use"
          resolve({ inUse: false, pid: null, process: null });
        }
      }
    });

    server.once("listening", () => {
      server.close(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({ inUse: false, pid: null, process: null });
        }
      });
    });

    // Catch unexpected errors during listen
    try {
      server.listen(port, host);
    } catch (err) {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ inUse: false, pid: null, process: null });
      }
    }
  });
}

/**
 * Method 2: Use system commands (cross-platform scan)
 * ✅ Can return PID + process name (Linux/macOS only by default)
 */
export function checkPortBySystem(port: number): Promise<{ inUse: boolean, pid: number | null, process: string | null }> {
  return new Promise((resolve) => {
    const platform = os.platform();
    let cmd;

    if (platform === "win32") {
      // Windows: PID only (process lookup would need extra work)
      cmd = `netstat -ano | findstr :${port}`;
    } else {
      // Linux/macOS: lsof shows PID + process name
      cmd = `lsof -i :${port} -sTCP:LISTEN -Pn`;
    }

    exec(cmd, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ inUse: false, pid: null, process: null });
        return;
      }

      if (platform === "win32") {
        // Example line: "TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   1234"
        const match = stdout.match(/LISTENING\s+(\d+)/);
        const pid = match ? parseInt(match[1], 10) : null;
        resolve({ inUse: true, pid, process: null });
      } else {
        // Example line: "node     1234 user   23u  IPv4  0x...  TCP *:3000 (LISTEN)"
        const lines = stdout.trim().split("\n");
        const parts = lines[0].split(/\s+/);
        const processName = parts[0];
        const pid = parseInt(parts[1], 10);
        resolve({ inUse: true, pid, process: processName });
      }
    });
  });
}
