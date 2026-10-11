/**
 * PairLobby: the 2-Player screen (TWO_PLAYER_PLAN.md step 5; canvas port of
 * components/game/PairLobby).
 *
 * What the player asked for, and what this is: one button, a big QR code, and
 * Cancel underneath. The other player points their phone's own camera app at
 * it, the link opens the game, and the map starts. Nothing to install on the
 * second phone, and no in-app scanner on either, so this screen never opens a
 * camera and needs no DOM element at all: the QR is drawn on the canvas from
 * the encoder's module matrix.
 *
 * The one thing that cannot ride in the QR is the answer, because the host is
 * not going to read anything the guest puts on screen unless it scans it, and
 * a second scan is exactly what this flow exists to avoid. So the answer goes
 * through the mailbox on the server the game was loaded from: one short blob,
 * once per pairing, and never on the path once the two phones are talking.
 *
 * Public Wi-Fi: the direct link needs the two phones to reach each other, and
 * cafe, hotel and office networks forbid that (client isolation). So each
 * phone also takes a seat in a relay on the same server (relay.ts), and when
 * the direct link has not opened after a few seconds the host picks the relay
 * instead and the guest follows. Because that makes the server part of the
 * game, the screen also says whether the server is awake (serverNap.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Graphics } from "pixi.js";
import {
  ArrowLeft, Users, WifiOff, QrCode, Camera, Radar, Info, Link2, Share2, Check,
} from "lucide-react";
import {
  WebRtcTransport, postAnswer, awaitAnswer, cancelRoom, CONNECT_TIMEOUT_MS,
} from "@/lib/net/webrtc";
import { buildPairUrl, newRoomId, type PackedSdp } from "@/lib/net/sdp";
import { RelayTransport, pickRoute, awaitHostHello, type PairRoute } from "@/lib/net/relay";
import type { NapState } from "@/lib/net/serverNap";
import { isForceRelayEnabled } from "@/lib/devFlags";
import { copyText, canShare, shareLink } from "@/lib/shareLink";
import { takePairInvite } from "@/lib/net/pairInvite";
import { getDeviceId, electPlayer } from "@/lib/net/deviceId";
import {
  isNearbyAvailable, missingNearbyPermission, startNearbyPairing,
  NearbyPlugin, NearbyTransport, type NearbyEndpoint,
} from "@/lib/net/nearby";
import { PROTOCOL_VERSION } from "@/lib/net/lockstep";
import { BUILD_SHA } from "@/lib/buildInfo";
import type { NetMessage, Transport } from "@/lib/net/transport";
import type { PlayerId } from "@/lib/net/commands";
import type { PairedSession } from "@/lib/net/transport";
import {
  COLOR, Icon, Label, Modal, Pressable, RADIUS, ScrollView, TEXT, View, tint, usePulse, useUiScreen, type IconSource,
} from "../kit/ui";
import {
  COPIED_RESET_MS, NAP_ICON, PAIR_AMBER, copyOutcome, napTextKey, napTipKey, napTone, napWorthShowing,
  permissionKey, qrGeometry, qrMatrix, qrRuns, routeKey, useServerNap, type CopyState, type PairPhase,
} from "./pairLobbyModel";
import { Spinner } from "./welcomeParts";

export type { PairedSession, PairPhase };

interface PairLobbyProps {
  onBack: () => void;
  onPaired: (session: PairedSession) => void;
  /** What this player is called on the other phone. */
  playerName?: string;
}

/** A QR code drawn on the canvas: dark modules on white, with the DOM's white card around it. */
function PairQr({ text, size }: { text: string; size: number }) {
  const matrix = useMemo(() => qrMatrix(text), [text]);
  // The code itself, inside the card's 16px padding.
  const inner = size - 32;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const { cell, offset } = qrGeometry(matrix.length, inner);
    matrix.forEach((row, r) => {
      for (const [c, len] of qrRuns(row)) g.rect(offset + c * cell, offset + r * cell, len * cell, cell);
    });
    g.fill(0x000000);
  }, [matrix, inner]);
  return (
    <View layout={{ width: size, height: size, padding: 16, borderRadius: RADIUS.xl, backgroundColor: COLOR.white }}>
      <View layout={{ width: inner, height: inner }}>
        <pixiGraphics draw={draw} />
      </View>
    </View>
  );
}

/**
 * The server's mood, as one line, with the whole story behind a hold.
 *
 * Hold rather than tap, and an Info mark so it reads as holdable: the game's
 * standard gesture for "tell me more" (CLAUDE.md). The explainer itself is
 * drawn by the screen (PairNapExplainer), so it covers the whole screen
 * rather than the box this chip sits in.
 */
function ServerNapChip({ state, onExplain }: { state: NapState; onExplain: () => void }) {
  const { t } = useTranslation();
  const tone = napTone(state);
  const pulse = usePulse(2000, state === "waking");
  return (
    <Pressable onHold={onExplain} pressedAlpha={0.85} label="server-nap" layout={{
      alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12,
      paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg,
      backgroundColor: tint(COLOR.card, 0.6), borderWidth: 1, borderColor: COLOR.border,
    }}>
      <Icon icon={NAP_ICON[state]} size={20} color={tone} alpha={state === "waking" ? 0.5 + 0.5 * pulse : 1} />
      <View layout={{ flex: 1 }}>
        <Label text={t(napTextKey(state))} size={TEXT.sm} wrap />
      </View>
      <Icon icon={Info} size={16} color={COLOR.mutedForeground} />
    </Pressable>
  );
}

function PairNapExplainer({ state, onClose }: { state: NapState; onClose: () => void }) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  return (
    <Modal screen={screen} onClose={onClose} title={t("pair.nap.whyTitle")} accent={napTone(state)} maxWidth={384}>
      <Icon icon={NAP_ICON[state]} size={28} color={napTone(state)} />
      <Label text={t("pair.nap.whyNap")} size={TEXT.sm} wrap />
      <Label text={t("pair.nap.whyMatters")} size={TEXT.sm} wrap />
      <Label text={t(napTipKey(state))} size={TEXT.sm} color={COLOR.mutedForeground} wrap />
    </Modal>
  );
}

/** A full-width card button with a big icon, a title and a hint (Nearby, Show the code). */
function PairOption({ icon, title, hint, onTap }: { icon: IconSource; title: string; hint: string; onTap: () => void }) {
  return (
    <Pressable onTap={onTap} label={title} layout={{
      alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 16, padding: 16,
      borderRadius: RADIUS.lg, backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.border,
    }}>
      <View layout={{ padding: 12, borderRadius: RADIUS.lg, backgroundColor: tint(COLOR.primary, 0.1) }}>
        <Icon icon={icon} size={24} color={COLOR.primary} />
      </View>
      <View layout={{ flex: 1 }}>
        <Label text={title} size={TEXT.base} weight="600" wrap />
        <Label text={hint} size={TEXT.sm} color={COLOR.mutedForeground} wrap />
      </View>
    </Pressable>
  );
}

/** A plain full-width button: Cancel (muted) or Try again / Join (card). */
function PairWideButton({ text, label, onTap, look = "muted", disabled, padding = 12, children }: {
  text?: string; label?: string; onTap: () => void; look?: "muted" | "card" | "accent"; disabled?: boolean; padding?: number; children?: ReactNode;
}) {
  return (
    <Pressable onTap={onTap} disabled={disabled} label={label ?? text} layout={{
      alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: look === "card" && children ? "flex-start" : "center",
      padding, borderRadius: RADIUS.lg,
      backgroundColor: look === "muted" ? COLOR.muted : COLOR.card,
      ...(look === "muted" ? {} : { borderWidth: 1, borderColor: look === "accent" ? tint(COLOR.primary, 0.5) : COLOR.border }),
    }}>
      {text !== undefined && <Label text={text} size={TEXT.base} weight="600" />}
      {children}
    </Pressable>
  );
}

/** The amber "this is taking a while" box. */
function PairSlowHint() {
  const { t } = useTranslation();
  return (
    <View layout={{
      alignSelf: "stretch", flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12,
      borderRadius: RADIUS.lg, backgroundColor: tint(PAIR_AMBER, 0.1),
    }}>
      <Icon icon={WifiOff} size={16} color={PAIR_AMBER} layout={{ marginTop: 2 }} />
      <View layout={{ flex: 1 }}>
        <Label text={t("pair.slowHint")} size={TEXT.sm} color={PAIR_AMBER} wrap />
      </View>
    </View>
  );
}

/** Centred, wrapped text (the DOM's `text-center` paragraphs). */
function PairCentered({ text, size = TEXT.sm, color = COLOR.mutedForeground, font }: {
  text: string; size?: number; color?: number; font?: "mono";
}) {
  return (
    <View layout={{ alignSelf: "stretch" }}>
      <Label text={text} size={size} color={color} font={font} align="center" wrap />
    </View>
  );
}

/**
 * The same invitation as the QR, as a link to send.
 *
 * The QR needs the two phones side by side and a camera that reads it; a link
 * goes through whatever the players already talk on. Copy works everywhere;
 * Share opens the phone's own share sheet where there is one. If the copy
 * fails outright the link is shown in full, so it is not simply the button
 * doing nothing.
 */
function InviteLinkActions({ url, width }: { url: string; width: number }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const copy = async () => {
    const outcome = copyOutcome(await copyText(url));
    setCopied(outcome.state);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (outcome.resets) resetTimer.current = setTimeout(() => setCopied("idle"), COPIED_RESET_MS);
  };

  const buttonLayout = {
    flex: 1, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 8,
    padding: 12, borderRadius: RADIUS.lg, backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.border,
  };
  return (
    <View layout={{ width, gap: 8 }}>
      <View layout={{ flexDirection: "row", gap: 8 }}>
        <Pressable onTap={() => void copy()} label="copy-invite" layout={buttonLayout}>
          <Icon icon={copied === "copied" ? Check : Link2} size={16} color={copied === "copied" ? COLOR.primary : COLOR.foreground} />
          <Label text={copied === "copied" ? t("pair.linkCopied") : t("pair.copyLink")} size={TEXT.base} weight="600" />
        </Pressable>
        {canShare() && (
          <Pressable
            onTap={() => void shareLink({ url, title: t("pair.shareTitle"), text: t("pair.shareText") })}
            label="share-invite" layout={buttonLayout}
          >
            <Icon icon={Share2} size={16} />
            <Label text={t("pair.shareLink")} size={TEXT.base} weight="600" />
          </Pressable>
        )}
      </View>
      {copied === "failed" && (
        <>
          <Label text={t("pair.copyFailed")} size={TEXT.xs} color={PAIR_AMBER} wrap />
          {/* The DOM showed a selectable read-only input here; the canvas
              has no text selection, so the link is shown in full to read. */}
          <View layout={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: RADIUS.base, backgroundColor: COLOR.background, borderWidth: 1, borderColor: COLOR.border }}>
            <Label text={url} size={TEXT.xs} font="mono" wrap />
          </View>
        </>
      )}
    </View>
  );
}

export function PairLobby({ onBack, onPaired, playerName = "Player" }: PairLobbyProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const [phase, setPhase] = useState<PairPhase>("choose");
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [napExplained, setNapExplained] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const roomRef = useRef<string | null>(null);
  const transportRef = useRef<WebRtcTransport | null>(null);
  const relayRef = useRef<RelayTransport | null>(null);
  const [route, setRoute] = useState<PairRoute | null>(null);
  const nap = useServerNap();

  /** Keep the link the pair settled on and close the other one. */
  const settle = useCallback((chosen: Transport) => {
    if (transportRef.current && transportRef.current !== chosen) transportRef.current.close();
    if (relayRef.current && relayRef.current !== chosen) relayRef.current.close();
    transportRef.current = null;
    relayRef.current = null;
    setRoute(chosen instanceof RelayTransport ? "relay" : "direct");
  }, []);

  // ── Nearby (step 9), where it exists ───────────────────────────────────
  const [nearbyReady] = useState(isNearbyAvailable);
  const [found, setFound] = useState<NearbyEndpoint[]>([]);
  const [token, setToken] = useState<(NearbyEndpoint & { token: string }) | null>(null);
  const [permissionNeeded, setPermissionNeeded] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const stopNearbyRef = useRef<(() => void) | null>(null);

  /**
   * Swap hellos, settle who is player 0, then hand the live link to the caller.
   *
   * WebRTC knows the answer before it starts: whoever showed the code is the
   * host. Nearby does not, because both phones advertise and discover at once
   * and neither pressed a different button. There the answer is "whoever's
   * device id sorts lower", and the other device's id arrives in the HELLO, so
   * the decision has to happen here rather than at the call site.
   *
   * It used to happen at the call site, off a ref that the hello had not filled
   * yet, so on a first Nearby connect both phones read null and both concluded
   * they were the host. Two player zeros: every command from both stamped with
   * the same number, and both sides believing they owned the repair.
   */
  const completeHandshake = useCallback(async (
    transport: Transport, role: { kind: "fixed"; localPlayer: PlayerId } | { kind: "elect" },
    /** The partner's hello, when it already came in (the guest, which waits
     *  for the host's hello to learn which link the host picked). */
    received?: Extract<NetMessage, { t: "hello" }>,
  ) => {
    const deviceId = await getDeviceId();
    const theirs = received ?? await new Promise<Extract<NetMessage, { t: "hello" }>>((resolve, reject) => {
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

    if (received) {
      transport.send({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        deviceId,
        name: playerName,
        build: BUILD_SHA,
      });
    }

    if (theirs.protocol !== PROTOCOL_VERSION) {
      // Said plainly, and early. The alternative is two boards that look fine
      // for ten seconds and then disagree about everything.
      throw new Error(t("pair.versionMismatch"));
    }
    // Both phones run this same comparison on the same two strings and reach
    // the same answer, with nothing further exchanged to disagree about.
    const elected = role.kind === "fixed" ? role.localPlayer : electPlayer(deviceId, theirs.deviceId);
    if (elected === null) throw new Error(t("pair.sameDevice"));
    const localPlayer: PlayerId = elected;

    setPhase("connected");
    onPaired({
      transport,
      localPlayer,
      isHost: localPlayer === 0,
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
    setAccepting(false);
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
      stopNearbyRef.current = await startNearbyPairing(playerName, {
        onFound: (e) => setFound(list => list.some(x => x.endpointId === e.endpointId) ? list : [...list, e]),
        onLost: (id) => setFound(list => list.filter(x => x.endpointId !== id)),
        // A connection is being offered. Both phones advertise AND discover,
        // so both can ask at the same moment and each ends up holding an
        // offer; whoever accepts second would be accepting a second link.
        // First offer wins on each phone, and the digits are the same either
        // way, so the players compare the same number whichever request got
        // there first.
        onToken: (e) => setToken(prev => prev ?? e),
        onConnected: async () => {
          stopNearbyRef.current?.();
          stopNearbyRef.current = null;
          const transport = await NearbyTransport.attach();
          // Who is player 0 is settled inside the handshake, once the hello has
          // brought the other device's id across. Neither phone picked a role,
          // so neither can be told one here.
          await completeHandshake(transport, { kind: "elect" });
        },
        onFailed: (reason) => { setProblem(reason); setPhase("failed"); },
      });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }, [completeHandshake, playerName]);

  /** Host: make an offer, show it, wait for the answer. */
  const startHosting = useCallback(async () => {
    setProblem(null);
    setSlow(false);
    setPhase("hosting");
    const abort = new AbortController();
    abortRef.current = abort;
    // The "taking a while" hint runs from the moment the partner answers, not
    // from the moment the code appears: waiting for somebody to scan, or to
    // open a link sent in a message, is not the connection being slow.
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const room = newRoomId();
      roomRef.current = room;
      // Take the relay seat first: it connects while the offer is gathered
      // and the partner finds their camera, so it is ready if it is needed.
      relayRef.current = RelayTransport.connect(room, "host");
      const { transport, offer } = await WebRtcTransport.host();
      transportRef.current = transport;
      setPairUrl(buildPairUrl(window.location.origin, room, offer));

      const answer = await awaitAnswer(room, abort.signal);
      slowTimer = setTimeout(() => setSlow(true), CONNECT_TIMEOUT_MS);
      await transport.acceptAnswer(answer);
      const relay = relayRef.current;
      const picked = await pickRoute(transport, relay, { forceRelay: isForceRelayEnabled() });
      const chosen: Transport = picked === "relay" && relay ? relay : transport;
      settle(chosen);
      clearTimeout(slowTimer);
      await completeHandshake(chosen, { kind: "fixed", localPlayer: 0 });
    } catch (err) {
      clearTimeout(slowTimer);
      relayRef.current?.close();
      relayRef.current = null;
      if (abort.signal.aborted) return;
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }, [completeHandshake, settle]);

  /** Guest: we arrived on a pairing link. Answer it and post the answer. */
  const joinWith = useCallback(async (room: string, offer: PackedSdp) => {
    setProblem(null);
    setSlow(false);
    setPhase("joining");
    const slowTimer = setTimeout(() => setSlow(true), CONNECT_TIMEOUT_MS);
    try {
      const { transport, answer } = await WebRtcTransport.guest(offer);
      transportRef.current = transport;
      // In the relay room before the answer goes out, so the host finds the
      // guest already seated whenever it decides the relay is the way.
      relayRef.current = RelayTransport.connect(room, "guest");
      await postAnswer(room, answer);
      // The host picks the link; the guest answers on whichever one the
      // host's hello arrives by, so the two can never settle on different ones.
      const links: Transport[] = relayRef.current ? [transport, relayRef.current] : [transport];
      const { transport: chosen, hello } = await awaitHostHello(links);
      settle(chosen);
      clearTimeout(slowTimer);
      await completeHandshake(chosen, { kind: "fixed", localPlayer: 1 }, hello);
    } catch (err) {
      clearTimeout(slowTimer);
      transportRef.current?.close();
      relayRef.current?.close();
      transportRef.current = null;
      relayRef.current = null;
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    }
  }, [completeHandshake, settle]);

  // Arriving on a pairing link jumps straight past the menu: the player tapped
  // a QR their friend was holding up, and asking them what they meant by that
  // would be asking a question they have already answered.
  //
  // The link is captured at startup (pairInvite.ts), not read from the address
  // bar here: by the time this screen mounts, the back guard has already
  // replaced the URL and the fragment is gone.
  useEffect(() => {
    const link = takePairInvite();
    if (!link) {
      return;
    }
    void joinWith(link.room, link.offer);
  }, [joinWith]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (roomRef.current) cancelRoom(roomRef.current);
    transportRef.current?.close();
    transportRef.current = null;
    relayRef.current?.close();
    relayRef.current = null;
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
    // A relay seat nobody settled on. The one a session took is out of this
    // ref by now (settle), so the live game is not cut off here.
    relayRef.current?.close();
  }, []);

  // max-w-md inside the page's 16px padding.
  const columnWidth = Math.min(448, screen.width - 32);
  // The phase body fills what the header leaves (36px row + 24px gap) and
  // centres in it; on a short screen it scrolls instead (the DOM page did).
  const bodyHeight = Math.max(0, screen.height - 32 - 60);
  const qrSize = Math.min(320, columnWidth);
  const napChip = (state: NapState) => <ServerNapChip state={state} onExplain={() => setNapExplained(true)} />;

  return (
    <View layout={{ width: screen.width, height: screen.height, backgroundColor: COLOR.background }}>
      <View layout={{ flex: 1, width: columnWidth, alignSelf: "center", paddingTop: 16, paddingBottom: 16 }}>
        <View layout={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <Pressable onTap={() => { cancel(); onBack(); }} label={t("common.back")}
            layout={{ padding: 8, borderRadius: RADIUS.lg, backgroundColor: COLOR.muted }}>
            <Icon icon={ArrowLeft} size={20} />
          </Pressable>
          <Label text={t("pair.title")} size={TEXT["2xl"]} weight="700" color={COLOR.primary} />
        </View>

        <ScrollView layout={{ flex: 1 }}>
          <View layout={{ minHeight: bodyHeight, justifyContent: "center" }}>
            {phase === "choose" && (
              <View layout={{ gap: 16 }}>
                <Label text={t("pair.intro")} size={TEXT.sm} color={COLOR.mutedForeground} wrap />
                {nap !== null && napChip(nap)}
                {/* Where the radios exist, this is the better door and goes first:
                    no code, no camera, no network. The QR stays for the web build
                    and for a phone that will not grant the permissions. */}
                {nearbyReady && (
                  <PairOption icon={Radar} title={t("pair.nearby")} hint={t("pair.nearbyHint")} onTap={() => void startNearby()} />
                )}
                {permissionNeeded !== null && (
                  <View layout={{ padding: 12, borderRadius: RADIUS.lg, backgroundColor: tint(PAIR_AMBER, 0.1) }}>
                    <Label text={t(permissionKey(permissionNeeded))} size={TEXT.sm} color={PAIR_AMBER} wrap />
                  </View>
                )}
                <PairOption icon={QrCode} title={t("pair.showCode")} hint={t("pair.showCodeHint")} onTap={() => void startHosting()} />
              </View>
            )}

            {phase === "hosting" && (
              <View layout={{ alignItems: "center", gap: 24 }}>
                {pairUrl !== null ? (
                  <>
                    <PairQr text={pairUrl} size={qrSize} />
                    <PairCentered text={t("pair.scanMe")} />
                    <InviteLinkActions url={pairUrl} width={qrSize} />
                  </>
                ) : (
                  <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Spinner size={20} color={COLOR.mutedForeground} />
                    <Label text={t("pair.preparing")} size={TEXT.base} color={COLOR.mutedForeground} />
                  </View>
                )}
                {slow && <PairSlowHint />}
                {/* Only when it has something to say: a server that answered
                    promptly is not news while the QR is up. */}
                {napWorthShowing(nap) && napChip(nap)}
                <PairWideButton text={t("common.cancel")} onTap={cancel} />
              </View>
            )}

            {phase === "joining" && (
              <View layout={{ alignItems: "center", gap: 16 }}>
                <Spinner size={32} color={COLOR.primary} />
                <PairCentered text={t("pair.joining")} />
                {napWorthShowing(nap) && napChip(nap)}
                {slow && <PairSlowHint />}
                <PairWideButton text={t("common.cancel")} onTap={() => { cancel(); onBack(); }} />
              </View>
            )}

            {phase === "nearby" && (
              <View layout={{ gap: 16 }}>
                {token ? (
                  <>
                    <PairCentered text={t("pair.confirmToken", { token: token.token })} />
                    <View layout={{ alignItems: "center" }}>
                      <Label text={token.token} size={TEXT["4xl"]} font="mono" weight="700" letterSpacing={3.6} color={COLOR.primary} />
                    </View>
                    <PairWideButton
                      text={t("pair.join")} look="accent" padding={16}
                      disabled={accepting}
                      onTap={() => {
                        // Guarded: a double tap on a slow phone would accept the
                        // same offer twice, and the second accept fails in a way
                        // that reads as the pairing breaking.
                        setAccepting(true);
                        void NearbyPlugin.accept({ endpointId: token.endpointId });
                      }}
                    />
                  </>
                ) : (
                  <>
                    <View layout={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Spinner size={20} color={COLOR.mutedForeground} />
                      <Label text={t("pair.looking")} size={TEXT.base} color={COLOR.mutedForeground} />
                    </View>
                    {found.map(e => (
                      <PairWideButton key={e.endpointId} look="card" label={e.name}
                        disabled={accepting}
                        onTap={() => {
                          // One request at a time. Tapping two partners, or the
                          // same one twice, leaves connections nobody accepts.
                          setAccepting(true);
                          void NearbyPlugin.connect({ endpointId: e.endpointId });
                        }}>
                        <Label text={e.name} size={TEXT.base} weight="600" />
                      </PairWideButton>
                    ))}
                  </>
                )}
                <PairWideButton text={t("common.cancel")}
                  onTap={() => { stopNearbyRef.current?.(); stopNearbyRef.current = null; setAccepting(false); setPhase("choose"); }} />
              </View>
            )}

            {phase === "connected" && (
              <View layout={{ alignItems: "center", gap: 12 }}>
                <Icon icon={Users} size={40} color={COLOR.primary} />
                <Label text={t("pair.connected")} size={TEXT.base} weight="600" />
                {route !== null && <PairCentered text={t(routeKey(route))} />}
              </View>
            )}

            {phase === "failed" && (
              <View layout={{ alignItems: "center", gap: 16 }}>
                <Icon icon={Camera} size={32} color={COLOR.destructive} />
                <PairCentered text={t("pair.failed")} color={COLOR.foreground} />
                {!!problem && <PairCentered text={problem} size={TEXT.xs} font="mono" />}
                <PairCentered text={t("pair.slowHint")} />
                <PairWideButton text={t("pair.tryAgain")} look="card" onTap={() => setPhase("choose")} />
              </View>
            )}
          </View>
        </ScrollView>
      </View>

      {napExplained && nap !== null && <PairNapExplainer state={nap} onClose={() => setNapExplained(false)} />}
    </View>
  );
}
