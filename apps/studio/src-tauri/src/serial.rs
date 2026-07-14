use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct SerialState {
    connection: Mutex<Option<Connection>>,
}

struct Connection {
    port: Box<dyn serialport::SerialPort>,
    stop_reader: Arc<AtomicBool>,
}

#[derive(Serialize)]
pub struct PortInfo {
    name: String,
    kind: String,
    vid: Option<u16>,
    pid: Option<u16>,
}

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let (kind, vid, pid) = match p.port_type {
                serialport::SerialPortType::UsbPort(u) => ("usb".into(), Some(u.vid), Some(u.pid)),
                serialport::SerialPortType::BluetoothPort => ("bluetooth".into(), None, None),
                serialport::SerialPortType::PciPort => ("pci".into(), None, None),
                serialport::SerialPortType::Unknown => ("unknown".into(), None, None),
            };
            PortInfo { name: p.port_name, kind, vid, pid }
        })
        .collect())
}

#[tauri::command]
pub fn serial_open(app: AppHandle, state: State<'_, SerialState>, path: String, baud: u32) -> Result<(), String> {
    let mut conn = state.connection.lock().unwrap();
    if conn.is_some() {
        return Err("already connected; close first".into());
    }
    let port = serialport::new(&path, baud)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(|e| e.to_string())?;

    let stop_reader = Arc::new(AtomicBool::new(false));
    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let stop = stop_reader.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    let _ = app.emit("serial:data", buf[..n].to_vec());
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => {
                    let _ = app.emit("serial:error", "read failed; port disconnected?");
                    break;
                }
            }
        }
    });

    *conn = Some(Connection { port, stop_reader });
    Ok(())
}

#[tauri::command]
pub fn serial_write(state: State<'_, SerialState>, data: Vec<u8>) -> Result<(), String> {
    let mut conn = state.connection.lock().unwrap();
    match conn.as_mut() {
        Some(c) => c.port.write_all(&data).map_err(|e| e.to_string()),
        None => Err("not connected".into()),
    }
}

#[tauri::command]
pub fn serial_close(state: State<'_, SerialState>) -> Result<(), String> {
    let mut conn = state.connection.lock().unwrap();
    if let Some(c) = conn.take() {
        c.stop_reader.store(true, Ordering::Relaxed);
    }
    Ok(())
}
