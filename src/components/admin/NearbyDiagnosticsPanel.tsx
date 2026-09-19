/**
 * NearbyDiagnosticsPanel — why the phones are not finding each other
 * (TWO_PLAYER_PLAN.md step 9).
 *
 * Nearby does not run in the emulator, so this step is the one that needs two
 * physical phones from the first day, and the thing those phones will actually
 * show you is nothing happening. "Found nobody", "was never allowed to look"
 * and "the plugin is not in this build" are the same picture from the outside,
 * which is exactly the case the admin rule in CLAUDE.md is about.
 *
 * So this says which: each permission by name, whether the radios are running,
 * every endpoint seen with its id, the authentication digits when a connection
 * is offered, and a log. Nothing here plays the game; it answers the question
 * "is the radio doing anything".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Radar, Check, X, Play, Square } from "lucide-react";
import {
  isNearbyAvailable, NearbyPlugin, startNearbyPairing,
  type NearbyEndpoint, type NearbyPermissions,
} from "@/lib/net/nearby";

export function NearbyDiagnosticsPanel({ onBack }: { onBack: () => void }) {
  const available = isNearbyAvailable();
  const [permissions, setPermissions] = useState<NearbyPermissions | null>(null);
  const [running, setRunning] = useState(false);
  const [endpoints, setEndpoints] = useState<NearbyEndpoint[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);

  const note = useCallback((line: string) => {
    setLog(l => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 20));
  }, []);

  const refreshPermissions = useCallback(async () => {
    if (!available) return;
    try { setPermissions(await NearbyPlugin.permissionState()); }
    catch (e) { note(`permissionState failed: ${e}`); }
  }, [available, note]);

  useEffect(() => { void refreshPermissions(); }, [refreshPermissions]);
  useEffect(() => () => { stopRef.current?.(); }, []);

  const start = async () => {
    try {
      const granted = await NearbyPlugin.requestNearbyPermissions();
      setPermissions(granted);
      stopRef.current = await startNearbyPairing("Diagnostics", {
        onFound: (e) => {
          note(`found ${e.name} (${e.endpointId})`);
          setEndpoints(list => list.some(x => x.endpointId === e.endpointId) ? list : [...list, e]);
        },
        onLost: (id) => { note(`lost ${id}`); setEndpoints(l => l.filter(x => x.endpointId !== id)); },
        onToken: (e) => { note(`connection offered by ${e.name}, digits ${e.token}`); setToken(e.token); },
        onConnected: () => note("connected"),
        onFailed: (reason) => note(`failed: ${reason}`),
      });
      setRunning(true);
      note("advertising and discovering");
    } catch (e) {
      note(`start failed: ${e}`);
    }
  };

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(false);
    setEndpoints([]);
    setToken(null);
    note("stopped");
  };

  const permRow = (label: string, value: string | undefined) => (
    <div className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono flex items-center gap-1 ${value === "granted" ? "text-primary" : "text-destructive"}`}>
        {value === "granted" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
        {value ?? "unknown"}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-primary">Nearby Diagnostics</h1>
        </div>

        {!available && (
          <p className="text-sm text-amber-500 bg-amber-500/10 rounded-lg p-3">
            The Nearby plugin is not in this build. It is Android only, and it
            does not run in an emulator: this panel is for two real phones.
            Everything above the transport can be exercised in Pair Loopback
            instead.
          </p>
        )}

        <div className="rounded-lg bg-card border border-border p-3">
          <div className="text-xs font-semibold mb-2">Permissions</div>
          {permRow("Bluetooth (31+)", permissions?.bluetooth)}
          {permRow("Nearby Wi-Fi (33+)", permissions?.wifi)}
          {permRow("Fine location (30-)", permissions?.location)}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => void start()} disabled={!available || running}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-40">
            <Play className="w-4 h-4" /> Start
          </button>
          <button onClick={stop} disabled={!running}
            className="p-3 rounded-lg bg-card border border-border hover:border-primary/50 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-40">
            <Square className="w-4 h-4" /> Stop
          </button>
        </div>

        <div className="rounded-lg bg-card border border-border p-3">
          <div className="flex items-center gap-2 text-xs font-semibold mb-2">
            <Radar className={`w-4 h-4 ${running ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
            {running ? "Radios on" : "Radios off"}
          </div>
          {token && (
            <div className="text-2xl font-mono tracking-widest text-primary text-center py-2">{token}</div>
          )}
          {endpoints.length === 0
            ? <div className="text-xs text-muted-foreground">no endpoints seen</div>
            : endpoints.map(e => (
                <button key={e.endpointId}
                  onClick={() => void NearbyPlugin.connect({ endpointId: e.endpointId })}
                  className="w-full text-left py-1.5 border-b border-border/40 last:border-0">
                  <div className="text-sm font-semibold">{e.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{e.endpointId}</div>
                </button>
              ))}
        </div>

        <div className="rounded-lg bg-card border border-border p-3">
          <div className="text-xs font-semibold mb-2">Log</div>
          {log.length === 0
            ? <div className="text-xs text-muted-foreground">nothing yet</div>
            : log.map((line, i) => (
                <div key={`${i}-${line}`} className="text-xs font-mono text-muted-foreground py-0.5">{line}</div>
              ))}
        </div>
      </div>
    </div>
  );
}
