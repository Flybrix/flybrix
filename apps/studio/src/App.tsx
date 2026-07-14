import { useCallback, useEffect, useRef, useState } from "react";
import { listPorts, TauriSerialTransport } from "./transport/tauriSerial";
import {
  BleTransport,
  scanBleDevices,
  stopBleScan,
  type BleDeviceInfo,
} from "./transport/bleTransport";
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

type TransportKind = "usb" | "ble";

function App() {
  const [screen, setScreen] = useState<Screen>("Connect");
  const [kind, setKind] = useState<TransportKind>("usb");
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [bleDevices, setBleDevices] = useState<BleDeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
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

  const scanBle = useCallback(async () => {
    setBleDevices([]);
    setScanning(true);
    try {
      await scanBleDevices((devices) => setBleDevices(devices), 5000);
    } catch (err) {
      appendLog(`BLE scan failed: ${err}`);
    } finally {
      setScanning(false);
    }
  }, [appendLog]);

  useEffect(() => {
    if (kind === "usb") refreshPorts();
    return () => {
      if (kind === "ble") stopBleScan().catch(() => {});
    };
  }, [kind, refreshPorts]);

  // Connect using whichever transport opener the caller supplies; the Device
  // and message router are identical regardless of USB vs BLE.
  const connect = async (label: string, open: Parameters<Device["connect"]>[0]) => {
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
      await dev.connect(open);
      device.current = dev;
      setStatus(`connected: ${label}`);
      setFirmware(dev.firmwareKey());
      appendLog(`opened ${label}; requested firmware version`);
    } catch (err) {
      appendLog(`connect failed: ${err}`);
    }
  };

  const connectUsb = (path: string) =>
    connect(path, (onData, onError) =>
      TauriSerialTransport.open(path, onData, onError),
    );

  const connectBle = (dev: BleDeviceInfo) =>
    connect(dev.name, (onData, onError) =>
      BleTransport.open(dev.address, onData, onError),
    );

  const disconnect = async () => {
    await device.current?.disconnect();
    device.current = null;
    setStatus("disconnected");
    setFirmware(null);
  };

  const connected = status !== "disconnected";

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
            <div className="transport-picker">
              <label>
                <input
                  type="radio"
                  name="transport"
                  checked={kind === "usb"}
                  onChange={() => setKind("usb")}
                  disabled={connected}
                />
                USB serial
              </label>
              <label>
                <input
                  type="radio"
                  name="transport"
                  checked={kind === "ble"}
                  onChange={() => setKind("ble")}
                  disabled={connected}
                />
                Bluetooth LE
              </label>
            </div>

            {kind === "usb" ? (
              <>
                <button onClick={refreshPorts} disabled={connected}>
                  Rescan ports
                </button>
                <ul className="devices">
                  {ports.map((p) => (
                    <li key={p.name}>
                      <code>{p.name}</code> {p.kind}
                      {p.vid === TEENSY_VID && <strong> (Teensy)</strong>}
                      <button onClick={() => connectUsb(p.name)} disabled={connected}>
                        Open
                      </button>
                    </li>
                  ))}
                  {ports.length === 0 && <li>No serial ports found.</li>}
                </ul>
              </>
            ) : (
              <>
                <button onClick={scanBle} disabled={connected || scanning}>
                  {scanning ? "Scanning…" : "Scan for devices"}
                </button>
                <ul className="devices">
                  {bleDevices.map((d) => (
                    <li key={d.address}>
                      {d.name}
                      {d.isFlybrix && <strong> (Flybrix)</strong>}{" "}
                      <span className="rssi">{d.rssi} dBm</span>
                      <button onClick={() => connectBle(d)} disabled={connected}>
                        Connect
                      </button>
                    </li>
                  ))}
                  {bleDevices.length === 0 && (
                    <li>{scanning ? "searching…" : "No devices found yet."}</li>
                  )}
                </ul>
              </>
            )}

            {connected && (
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
