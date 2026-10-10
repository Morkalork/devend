/**
 * Live map tuner (admin only), opened from the in-game menu (canvas port of
 * components/game/MapTuningModal.tsx).
 *
 * Deliberately usable mid-map: par and the clear threshold are both read at
 * check time, so a change lands on the run in progress rather than the next
 * one. That is the whole point, the moment you can judge par is the moment you
 * have just solved the map and can feel it took five cuts and not eight.
 *
 * Dev tooling, so the copy is plain English rather than i18n keys, matching the
 * Admin panel and the Playground.
 */
import { useEffect, useState } from 'react';
import { X, RotateCcw, Copy, Check, SlidersHorizontal } from 'lucide-react';
import {
  authoredBaseline, clearMapTuning, isMapTuned, setMapTuning, tuningAsYaml,
} from '@/lib/mapTuning';
import type { LevelConfig } from '@/types/level';
import {
  Appear, COLOR, Icon, Label, Pressable, RADIUS, ScrollView, TEXT, TextField, View, tint, useUiScreen,
} from "../kit/ui";
import { WrapText } from "./modalParts";
import { TUNING_FIELDS, parseTuningInput, tuningStep, type TuningFieldSpec } from "./MapTuningModalModel";

interface MapTuningModalProps {
  /** The level AS PLAYED, i.e. with any current overrides already applied. */
  level: LevelConfig;
  onClose: () => void;
}

interface FieldProps {
  spec: TuningFieldSpec;
  /** Distinguishes this field's hidden keyboard input from every other one. */
  inputId: string;
  value: number;
  authored: number;
  onChange: (n: number) => void;
}

/** A square step button, `-` or `+`. */
function StepButton({ text, onTap, disabled, label }: { text: string; onTap: () => void; disabled: boolean; label: string }) {
  return (
    <Pressable
      onTap={onTap}
      disabled={disabled}
      label={label}
      layout={{ width: 40, height: 40, borderRadius: RADIUS.lg, backgroundColor: COLOR.muted, alignItems: "center", justifyContent: "center" }}
    >
      <Label text={text} size={TEXT.lg} weight="700" color={COLOR.foreground} />
    </Pressable>
  );
}

function TuningField({ spec, inputId, value, authored, onChange }: FieldProps) {
  const { label, hint, min, max, suffix } = spec;
  const changed = value !== authored;
  const step = tuningStep(value, min, max);
  // What the field shows while typing, which may be briefly blank or out of
  // range; only a parseable number is committed (clamped).
  const [draft, setDraft] = useState(String(value));
  // A step press or a clamp moves the value under the text: show the new value,
  // unless the text already says it.
  useEffect(() => {
    setDraft(prev => (parseTuningInput(prev, min, max) === value ? prev : String(value)));
  }, [value, min, max]);

  return (
    <View layout={{ gap: 6 }}>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Label text={label} size={TEXT.sm} weight="600" color={COLOR.foreground} />
        {changed && (
          <View layout={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: RADIUS.base, backgroundColor: tint(COLOR.primary, 0.2) }}>
            <Label text={`was ${authored}`} size={10} font="mono" color={COLOR.primary} />
          </View>
        )}
      </View>
      <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <StepButton text="-" label={`Decrease ${label}`} disabled={!step.canDown} onTap={() => onChange(step.down)} />
        <TextField
          id={inputId}
          value={draft}
          placeholder={String(value)}
          inputMode="numeric"
          onChange={(text) => {
            setDraft(text);
            const n = parseTuningInput(text, min, max);
            if (n !== null) onChange(n);
          }}
          layout={{ flex: 1, ...(changed ? { borderColor: COLOR.primary } : {}) }}
        />
        {suffix && (
          <View layout={{ width: 16 }}>
            <Label text={suffix} size={TEXT.sm} color={COLOR.mutedForeground} />
          </View>
        )}
        <StepButton text="+" label={`Increase ${label}`} disabled={!step.canUp} onTap={() => onChange(step.up)} />
      </View>
      <WrapText text={hint} size={TEXT.xs} color={COLOR.mutedForeground} />
    </View>
  );
}

export function MapTuningModal({ level, onClose }: MapTuningModalProps) {
  const screen = useUiScreen();
  // Captured from map.yml before any override was written onto the level, so
  // "was N" survives even though the overrides mutate the object in place.
  const authored = authoredBaseline(level.id)
    ?? { expectedCuts: level.expectedCuts, sizeThreshold: level.sizeThreshold };
  // Re-render locally on each write; useLevelManager separately re-derives the
  // level the game plays, so the board and this panel never disagree.
  const [, bump] = useState(0);
  const [copied, setCopied] = useState(false);
  const tuned = isMapTuned(level.id);

  const update = (patch: Parameters<typeof setMapTuning>[1]) => {
    setMapTuning(level.id, patch);
    bump(n => n + 1);
  };

  const reset = () => {
    clearMapTuning(level.id);
    bump(n => n + 1);
  };

  const copyYaml = async () => {
    const text = tuningAsYaml(level.id);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked (webview/insecure origin): the YAML is shown below anyway */
    }
  };

  const smallButton = {
    flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 8,
    paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderRadius: RADIUS.lg, backgroundColor: COLOR.muted,
  };

  return (
    <View
      layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, justifyContent: "center", alignItems: "center", padding: 16 }}
      zIndex={70}
    >
      <Pressable
        onTap={onClose}
        pressedAlpha={1}
        layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: tint(COLOR.black, 0.7) }}
      />
      <Appear fromScale={0.95} duration={0.2}>
        <View layout={{
          width: Math.min(384, screen.width - 32), maxHeight: screen.height * 0.85,
          borderRadius: RADIUS.xl, backgroundColor: COLOR.card, borderColor: COLOR.border, borderWidth: 1,
        }}>
          <ScrollView layout={{ flexShrink: 1, padding: 20, gap: 20 }}>
            <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon icon={SlidersHorizontal} size={16} color={COLOR.primary} />
              <View layout={{ flex: 1 }}>
                <Label text="Tune map" size={TEXT.lg} weight="700" color={COLOR.foreground} />
              </View>
              <Pressable onTap={onClose} label="Close" layout={{ padding: 4, borderRadius: RADIUS.base }}>
                <Icon icon={X} size={20} color={COLOR.foreground} />
              </Pressable>
            </View>

            <View layout={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Label text={level.id} size={TEXT.xs} font="mono" color={COLOR.mutedForeground} />
              {tuned && (
                <View layout={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: RADIUS.base, backgroundColor: tint(COLOR.primary, 0.2) }}>
                  <Label text="TUNED" size={TEXT.xs} font="mono" color={COLOR.primary} />
                </View>
              )}
            </View>

            {TUNING_FIELDS.map(spec => (
              <TuningField
                key={spec.key}
                spec={spec}
                inputId={`map-tuning-${spec.key}`}
                value={level[spec.key]}
                authored={authored[spec.key]}
                onChange={(n) => update({ [spec.key]: n })}
              />
            ))}

            <WrapText
              text="Both land on the map in progress: neither is read when the board is built, so nothing restarts and you keep your cuts. Ball roster and speeds are not tunable yet."
              size={TEXT.xs} color={COLOR.mutedForeground}
            />

            {tuned && (
              <View layout={{ gap: 8 }}>
                <View layout={{ borderRadius: RADIUS.lg, backgroundColor: COLOR.background, borderColor: COLOR.border, borderWidth: 1, padding: 8 }}>
                  {/* `whitespace-pre overflow-x-auto`: the lines never wrap, the block scrolls sideways. */}
                  <ScrollView direction="horizontal">
                    <Label text={tuningAsYaml(level.id)} size={11} font="mono" color={COLOR.mutedForeground} />
                  </ScrollView>
                </View>
                <View layout={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onTap={() => { void copyYaml(); }} label="Copy for map.yml" layout={{ ...smallButton, flex: 1 }}>
                    <Icon icon={copied ? Check : Copy} size={16} color={copied ? COLOR.primary : COLOR.foreground} />
                    <Label text={copied ? 'Copied' : 'Copy for map.yml'} size={TEXT.sm} color={COLOR.foreground} />
                  </Pressable>
                  <Pressable onTap={reset} label="Reset" layout={smallButton}>
                    <Icon icon={RotateCcw} size={16} color={COLOR.foreground} />
                    <Label text="Reset" size={TEXT.sm} color={COLOR.foreground} />
                  </Pressable>
                </View>
                <WrapText
                  text="Overrides are saved per map and survive a reload, so a tuned run never files on the highscore ledger. Paste the lines above into public/map.yml to make them real."
                  size={TEXT.xs} color={COLOR.mutedForeground}
                />
              </View>
            )}
          </ScrollView>
        </View>
      </Appear>
    </View>
  );
}
