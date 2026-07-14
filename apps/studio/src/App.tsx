import { useCallback, useEffect, useRef, useState } from "react";
import { listPorts } from "./transport/tauriSerial";
import { TEENSY_VID, type PortInfo } from "./transport/Transport";
import { Device } from "./device";
import "./App.css";

const SCREENS = [
  "Connect",
  "Configuration",
  "Tuning",
  "Motors",
  "LED",
  "Telemetry",
  "Log",
] as const;
type Screen = (typeof SCREENS)[number];

function App() {
  const [screen, setScreen] = useState<Screen>("Connect");
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [status, setStatus] = useState("disconnected");
  const [firmware, setFirmware] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>([]);
  const device = useRef<Device | null>(null);

  const appendLog = useCallback((line: string) => {
    setLog((l) => [...l.slice(-200), line]);
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await listPorts());
    } catch (err) {
      appendLog(`port scan failed: ${err}`);
    }
  }, [appendLog]);

  useEffect(() => {
    refreshPorts();
  }, [refreshPorts]);

  const connect = async (path: string) => {
    const dev = new Device({
      onReceive: (type) => {
        setCounts((c) => ({ ...c, [type]: (c[type] ?? 0) + 1 }));
        if (device.current) setFirmware(device.current.firmwareKey());
      },
      onLog: appendLog,
      onDisconnect: () => {
        setStatus("disconnected");
        setFirmware(null);
      },
    });
    try {
      await dev.connect(path);
      device.current = dev;
      setStatus(`connected: ${path}`);
      setFirmware(dev.firmwareKey());
      appendLog(`opened ${path}; requested firmware version`);
    } catch (err) {
      appendLog(`connect failed: ${err}`);
    }
  };

  const disconnect = async () => {
    await device.current?.disconnect();
    device.current = null;
    setStatus("disconnected");
    setFirmware(null);
  };

  return (
    <div className="shell">
      <nav className="sidebar">
        <h1>Flybrix Studio</h1>
        {SCREENS.map((s) => (
          <button
            key={s}
            className={s === screen ? "active" : ""}
            onClick={() => setScreen(s)}
          >
            {s}
          </button>
        ))}
        <div className="status">
          {status}
          {firmware && <div>firmware {firmware}</div>}
        </div>
      </nav>
      <main>
        {screen === "Connect" ? (
          <section>
            <h2>Connect</h2>
            <button onClick={refreshPorts}>Rescan ports</button>
            <ul className="ports">
              {ports.map((p) => (
                <li key={p.name}>
                  <code>{p.name}</code> {p.kind}
                  {p.vid === TEENSY_VID && <strong> (Teensy)</strong>}
                  <button onClick={() => connect(p.name)}>Open</button>
                </li>
              ))}
              {ports.length === 0 && <li>No serial ports found.</li>}
            </ul>
            {status !== "disconnected" && (
              <>
                <button onClick={disconnect}>Disconnect</button>
                <h3>Messages received</h3>
                <ul>
                  {Object.entries(counts).map(([type, n]) => (
                    <li key={type}>
                      {type}: {n}
                    </li>
                  ))}
                  {Object.keys(counts).length === 0 && (
                    <li>none yet — waiting for board telemetry</li>
                  )}
                </ul>
              </>
            )}
          </section>
        ) : (
          <section>
            <h2>{screen}</h2>
            <p>Coming soon — ported from the legacy configuration utility.</p>
          </section>
        )}
        <pre className="log">{log.join("\n")}</pre>
      </main>
    </div>
  );
}

export default App;
