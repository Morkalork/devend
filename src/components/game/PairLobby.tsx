/**
 * PairLobby — the 2-Player screen (TWO_PLAYER_PLAN.md step 5).
 *
 * What the player asked for, and what this is: one button, a big QR code, and
 * Cancel underneath. The other player points their phone's own camera app at
 * it, the link opens the game, and the map starts. Nothing to install on the
 * second phone, and no in-app scanner on either.
 *
 * The one thing that cannot ride in the QR is the answer, because the host is
 * not going to read anything the guest puts on screen unless it scans it, and
 * a second scan is exactly what this flow exists to avoid. So the answer goes
 * through the mailbox on the server the game was loaded from: one short blob,
 * once per pairing, and never on the path once the two phones are talking.
 *
 * The offline fallback is deliberately kept: with no internet at the table the
 * host can scan the guest's answer code instead, which is the only place a
 * camera appears in the app at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Users, WifiOff, QrCode, Camera, Loader2, Radar } from "lucide-react";
import qrcode from "qrcode-generator";
import {
  WebRtcTransport, postAnswer, awaitAnswer, cancelRoom, CONNECT_TIMEOUT_MS,
} from "@/lib/net/webrtc";
import { buildPairUrl, parsePairUrl, newRoomId, type PackedSdp } from "@/lib/net/sdp";
import { getDeviceId } from "@/lib/net/deviceId";
import {
  isNearbyAvailable, missingNearbyPermission, startNearbyPairing,
  NearbyPlugin, NearbyTransport, type NearbyEndpoint,
} from "@/lib/net/nearby";
import { PROTOCOL_VERSION } from "@/lib/net/lockstep";
import { BUILD_SHA } from "@/lib/buildInfo";
import type { NetMessage, Transport } from "@/lib/net/transport";
import type { PlayerId } from "@/lib/net/commands";

export type PairPhase =
  | "choose"        // host, or find nearby
  | "hosting"       // showing the code, waiting
  | "joining"       // answering an offer we arrived with
  | "nearby"        // the radios are looking
  | "connected"
  | "failed";

export interface PairedSession {
  /**
   * The live link, as the interface rather than as whichever implementation
   * produced it. Nearby on Android, WebRTC on the web and at the desk, and the
   * lockstep above cannot tell which, which is what the interface was for.
   */
  transport: Transport;
  localPlayer: PlayerId;
  isHost: boolean;
  /** The other phone's device id, for the pair identity (step 6b). */
  remoteDeviceId: string;
  /** What the other player is called. */
  remoteName: string;
}

interface PairLobbyProps {
  onBack: () => void;
  onPaired: (session: PairedSession) => void;
  /** What this player is called on the other phone. */
  playerName?: string;
}

/** An SVG QR code. A canvas would need a ref and a paint; this is one string. */
function QrSvg({ text, className }: { text: string; className?: string }) {
  const svg = useMemo(() => {
    // Type 0 = let the encoder pick the smallest version that fits; L is the
    // lowest error correction, which keeps the modules big and therefore easy
    // to scan off a phone screen. A code on a screen is not going to be
    // scratched or printed badly, which is what higher levels buy.
    const qr = qrcode(0, "L");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return (
    <div
      className={className}
      // The encoder's own SVG, built from `text` in this component. No user
      // content reaches it.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function PairLobby({ onBack, onPaired, playerName = "Player" }: PairLobbyProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<PairPhase>("choose");
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const roomRef = useRef<string | null>(null);
  const transportRef = useRef<WebRtcTransport | null>(null);

  // ── Nearby (step 9), where it exists ───────────────────────────────────
  const [nearbyReady] = useState(isNearbyAvailable);
  const [found, setFound] = useState<NearbyEndpoint[]>([]);
  const [token, setToken] = useState<(NearbyEndpoint & { token: string }) | null>(null);
  const [permissionNeeded, setPermissionNeeded] = useState<string | null>(null);
  const stopNearbyRef = useRef<(() => void) | null>(null);

  /** Swap hellos, then hand the live link to the caller. */
  const completeHandshake = useCallback(async (
    transport: Transport, localPlayer: PlayerId, isHost: boolean,
  ) => {
    const deviceId = await getDeviceId();
    const theirs = await new Promise<Extract<NetMessage, { t: "hello" }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no hello")), CONNECT_TIMEOUT_MS);
      transport.onMessage(msg => {
        if (msg.t !== "hello") return;
        clearTimeout(timer);
        resolve(msg);
      });
      transport.send({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        deviceId,
        name: playerName,
        build: BUILD_SHA,
      });
    });

    if (theirs.protocol !== PROTOCOL_VERSION) {
      // Said plainly, and early. The alternative is two boards that look fine
      // for ten seconds and then disagree about everything.
      throw new Error(t("pair.versionMismatch"));
    }
    pendingRemoteRef.current = theirs.deviceId;
    setPhase("connected");
    onPaired({
      transport,
      localPlayer,
      isHost,
      remoteDeviceId: theirs.deviceId,
      remoteName: theirs.name || t("pair.partner"),
    });
  }, [onPaired, playerName, t]);

  /**
   * Nearby: both phones press this, the radios do the rest.
   *
   * Who ends up player 0 is settled by whose device id sorts lower, so both
   * phones reach the same answer without either asking, and neither player is
   * made to pick a role for a thing that has none.
   */
  const startNearby = useCallback(async () => {
    setProblem(null);
    setFound([]);
    setToken(null);
    const missing = await missingNearbyPermission();
    if (missing) {
      const granted = await NearbyPlugin.requestNearbyPermissions();
      if (granted[missing as keyof typeof granted] !== "granted") {
        setPermissionNeeded(missing);
        return;
      }
    }
    setPermissionNeeded(null);
    setPhase("nearby");
    try {
      const myDevice = await getDeviceId();
      stopNearbyRef.current = await startNearbyPairing(playerName, {
        onFound: (e) => setFound(list => list.some(x => x.endpointId === e.endpointId) ? list : [...list, e]),
        onLost: (id) => setFound(list => list.filter(x => x.endpointId !== id)),
        onToken: (e) => setToken(e),
        onConnected: async () => {
          stopNearbyRef.current?.();
          stopNearbyRef.current = null;
          const transport = await NearbyTransport.attach();
          // Lower device id hosts. Both phones compute it from the same two
          // strings, so both get the same answer with nothing exchanged.
          const theirDevice = pendingRemoteRef.current;
          const isHost = theirDevice === null ? true : myDevice < theirDevice;
          await completeHandshake(transport, isHost ? 0 : 1, isHost);
        },
        onFailed: (reason) => { setProblem(reason); setPhase("failed"); },
      });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }, [completeHandshake, playerName]);

  /**
   * The other device's id, learned from the hello.
   *
   * Nearby settles who hosts from the two device ids, and the hello is where
   * the second one arrives, so the decision is made inside completeHandshake
   * rather than before it. Held in a ref because the connected callback closes
   * over it.
   */
  const pendingRemoteRef = useRef<string | null>(null);

  /** Host: make an offer, show it, wait for the answer. */
  const startHosting = useCallback(async () => {
    setProblem(null);
    setSlow(false);
    setPhase("hosting");
    const abort = new AbortController();
    abortRef.current = abort;
    const slowTimer = setTimeout(() => setSlow(true), CONNECT_TIMEOUT_MS);
    try {
      const room = newRoomId();
      roomRef.current = room;
      const { transport, offer } = await WebRtcTransport.host();
      transportRef.current = transport;
      setPairUrl(buildPairUrl(window.location.origin, room, offer));

      const answer = await awaitAnswer(room, abort.signal);
      await transport.acceptAnswer(answer);
      await transport.waitOpen();
      clearTimeout(slowTimer);
      await completeHandshake(transport, 0, true);
    } catch (err) {
      clearTimeout(slowTimer);
      if (abort.signal.aborted) return;
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }, [completeHandshake]);

  /** Guest: we arrived on a pairing link. Answer it and post the answer. */
  const joinWith = useCallback(async (room: string, offer: PackedSdp) => {
    setProblem(null);
    setSlow(false);
    setPhase("joining");
    const slowTimer = setTimeout(() => setSlow(true), CONNECT_TIMEOUT_MS);
    try {
      const { transport, answer } = await WebRtcTransport.guest(offer);
      transportRef.current = transport;
      await postAnswer(room, answer);
      await transport.waitOpen();
      clearTimeout(slowTimer);
      await completeHandshake(transport, 1, false);
    } catch (err) {
      clearTimeout(slowTimer);
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }, [completeHandshake]);

  // Arriving on a pairing link jumps straight past the menu: the player tapped
  // a QR their friend was holding up, and asking them what they meant by that
  // would be asking a question they have already answered.
  useEffect(() => {
    const link = parsePairUrl(window.location.hash);
    if (!link) return;
    // Clear the fragment so a refresh does not try to answer a spent offer.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void joinWith(link.room, link.offer);
  }, [joinWith]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (roomRef.current) cancelRoom(roomRef.current);
    transportRef.current?.close();
    transportRef.current = null;
    roomRef.current = null;
    stopNearbyRef.current?.();
    stopNearbyRef.current = null;
    setPairUrl(null);
    setPhase("choose");
  }, []);

  // Anything still open when this screen goes away is closed with it.
  useEffect(() => () => {
    abortRef.current?.abort();
    if (roomRef.current) cancelRoom(roomRef.current);
    stopNearbyRef.current?.();
  }, []);

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => { cancel(); onBack(); }}
            className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
            aria-label={t("common.back")}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-primary">{t("pair.title")}</h1>
        </div>

        {phase === "choose" && (
          <div className="flex-1 flex flex-col justify-center gap-4">
            <p className="text-sm text-muted-foreground">{t("pair.intro")}</p>
            {/* Where the radios exist, this is the better door and goes first:
                no code, no camera, no network. The QR stays for the web build
                and for a phone that will not grant the permissions. */}
            {nearbyReady && (
              <button onClick={() => void startNearby()}
                className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4">
                <div className="p-3 rounded-lg bg-primary/10"><Radar className="w-6 h-6 text-primary" /></div>
                <div className="text-left">
                  <div className="font-semibold">{t("pair.nearby")}</div>
                  <div className="text-sm text-muted-foreground">{t("pair.nearbyHint")}</div>
                </div>
              </button>
            )}
            {permissionNeeded && (
              <p className="text-sm text-amber-500 bg-amber-500/10 rounded-lg p-3">
                {permissionNeeded === "location" ? t("pair.needLocation") : t("pair.needPermission")}
              </p>
            )}
            <button onClick={startHosting}
              className="w-full p-4 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10"><QrCode className="w-6 h-6 text-primary" /></div>
              <div className="text-left">
                <div className="font-semibold">{t("pair.showCode")}</div>
                <div className="text-sm text-muted-foreground">{t("pair.showCodeHint")}</div>
              </div>
            </button>
          </div>
        )}

        {phase === "hosting" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6">
            {pairUrl ? (
              <>
                <QrSvg text={pairUrl} className="w-full max-w-xs [&>svg]:w-full [&>svg]:h-auto bg-white p-4 rounded-xl" />
                <p className="text-sm text-center text-muted-foreground">{t("pair.scanMe")}</p>
              </>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" /> {t("pair.preparing")}
              </div>
            )}
            {slow && (
              <div className="flex items-start gap-2 text-sm text-amber-500 bg-amber-500/10 rounded-lg p-3">
                <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t("pair.slowHint")}</span>
              </div>
            )}
            <button onClick={cancel}
              className="w-full p-3 rounded-lg bg-muted hover:bg-muted/80 font-semibold">
              {t("common.cancel")}
            </button>
          </div>
        )}

        {phase === "joining" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("pair.joining")}</p>
            {slow && (
              <div className="flex items-start gap-2 text-sm text-amber-500 bg-amber-500/10 rounded-lg p-3">
                <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t("pair.slowHint")}</span>
              </div>
            )}
            <button onClick={() => { cancel(); onBack(); }}
              className="w-full p-3 rounded-lg bg-muted hover:bg-muted/80 font-semibold">
              {t("common.cancel")}
            </button>
          </div>
        )}

        {phase === "nearby" && (
          <div className="flex-1 flex flex-col justify-center gap-4">
            {token ? (
              <>
                <p className="text-sm text-center text-muted-foreground">
                  {t("pair.confirmToken", { token: token.token })}
                </p>
                <div className="text-4xl font-mono font-bold text-center tracking-widest text-primary">
                  {token.token}
                </div>
                <button
                  onClick={() => { pendingRemoteRef.current = null; void NearbyPlugin.accept({ endpointId: token.endpointId }); }}
                  className="w-full p-4 rounded-lg bg-card border border-primary/50 font-semibold"
                >
                  {t("pair.join")}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" /> {t("pair.looking")}
                </div>
                {found.map(e => (
                  <button key={e.endpointId}
                    onClick={() => void NearbyPlugin.connect({ endpointId: e.endpointId })}
                    className="w-full p-3 rounded-lg bg-card border border-border hover:border-primary/50 text-left">
                    <span className="font-semibold">{e.name}</span>
                  </button>
                ))}
              </>
            )}
            <button onClick={() => { stopNearbyRef.current?.(); stopNearbyRef.current = null; setPhase("choose"); }}
              className="w-full p-3 rounded-lg bg-muted hover:bg-muted/80 font-semibold">
              {t("common.cancel")}
            </button>
          </div>
        )}

        {phase === "connected" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Users className="w-10 h-10 text-primary" />
            <p className="font-semibold">{t("pair.connected")}</p>
          </div>
        )}

        {phase === "failed" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Camera className="w-8 h-8 text-destructive" />
            <p className="text-sm text-center">{t("pair.failed")}</p>
            {problem && <p className="text-xs text-muted-foreground font-mono text-center">{problem}</p>}
            <p className="text-sm text-center text-muted-foreground">{t("pair.slowHint")}</p>
            <button onClick={() => setPhase("choose")}
              className="w-full p-3 rounded-lg bg-card border border-border hover:border-primary/50 font-semibold">
              {t("pair.tryAgain")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
