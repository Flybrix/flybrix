import { useCallback, useEffect, useRef, useState } from "react";
import { listPorts, TauriSerialTransport } from "./transport/tauriSerial";
import { TEENSY_VID, type PortInfo } from "./transport/Transport";
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
  const [log, setLog] = useState<string[]>([]);
  const transport = useRef<TauriSerialTransport | null>(null);

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
    try {
      transport.current = await TauriSerialTransport.open(
        path,
        (data) => appendLog(`rx ${data.length} bytes`),
        (msg) => {
          appendLog(`error: ${msg}`);
          setStatus("disconnected");
        },
      );
      setStatus(`connected: ${path}`);
      appendLog(`opened ${path}`);
    } catch (err) {
      appendLog(`connect failed: ${err}`);
    }
  };

  const disconnect = async () => {
    await transport.current?.close();
    transport.current = null;
    setStatus("disconnected");
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
        <div className="status">{status}</div>
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
              <button onClick={disconnect}>Disconnect</button>
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
