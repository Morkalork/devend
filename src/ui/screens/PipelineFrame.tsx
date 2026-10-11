/**
 * The frame every between-map stage draws in (UI_REDO_PLAN.md, phase 2): a
 * line saying where in the run this is, the stage strip, the stage's one big
 * figure, then the stage's own content, left-aligned on a flat surface.
 *
 * Debrief (LevelCompleteOverlay), Promotion (CapstoneDraftScreen) and Store
 * (UpgradeShop) are separate screens in the session's state machine; drawing
 * all three in this frame is what makes them read as one screen whose content
 * changes, with the stages before and after always in view.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Appear, Headline, Label, ROLE, ScrollView, StageStrip, TEXT, View, useUiScreen, type HeadlineProps,
} from "../kit/ui";
import { pipelineColumnWidth, pipelineStages, type BetweenMapPlan, type PipelineStageId } from "./pipelineModel";


interface PipelineFrameProps {
  plan: BetweenMapPlan;
  at: PipelineStageId;
  accent: number;
  headline: HeadlineProps;
  children?: ReactNode;
  /**
   * Drawn after the children across the whole screen width, not the column:
   * the store's shelf, a carousel whose peeking neighbours are its margin.
   */
  shelf?: ReactNode;
  /** Back in the column after the shelf (the Continue button under a shelf). */
  footer?: ReactNode;
  /** Drawn over everything (a stage's explainer or chooser modal). */
  overlay?: ReactNode;
}

/** How far a stage's content slides in from, in px. */
const STAGE_SLIDE = 28;

export function PipelineFrame({ plan, at, accent, headline, children, shelf, footer, overlay }: PipelineFrameProps) {
  const { t } = useTranslation();
  const screen = useUiScreen();
  const width = pipelineColumnWidth(screen.width);
  return (
    <View layout={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, backgroundColor: ROLE.surface }}>
      <ScrollView layout={{ width: screen.width, height: screen.height }}>
        <View layout={{ width: screen.width, minHeight: screen.height, alignItems: "center", gap: 16, paddingTop: 20, paddingBottom: 24 }}>
          <View label={`pipeline-${at}`} layout={{ width, gap: 16 }}>
            <View layout={{ gap: 10 }}>
              <Label text={t("pipeline.afterLevel", { level: plan.clearedLevel })} size={TEXT.xs} color={ROLE.muted} />
              <StageStrip stages={pipelineStages(plan, at, t)} accent={accent} />
            </View>
            {/* The strip stays put from stage to stage; what is under it slides
                in from the right, so moving on reads as moving along the line. */}
            <Appear fromX={STAGE_SLIDE} duration={0.3} layout={{ gap: 16 }}>
              <Headline {...headline} />
              {children}
            </Appear>
          </View>
          {shelf !== undefined && <View layout={{ width: screen.width, alignItems: "center" }}>{shelf}</View>}
          {footer !== undefined && <View layout={{ width, gap: 16 }}>{footer}</View>}
        </View>
      </ScrollView>
      {overlay}
    </View>
  );
}
