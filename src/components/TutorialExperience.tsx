import React, { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  advanceTutorial,
  completeTutorial,
  dismissTutorial,
  postponeTutorial,
  shouldShowTutorialWelcome,
  startTutorial,
  tutorialSteps,
  tutorialTopics,
  TutorialMode,
  TutorialState,
  tutorialProgress,
} from "../lib/tutorial";
import { t } from "../lib/i18n";
import { NavIcon } from "./icons";
import { useGlobalKeyDown } from "./useKeyboard";

export type TutorialView = "none" | "welcome" | "tour" | "center";

type Props = {
  view: TutorialView;
  state: TutorialState;
  currentMode: string;
  onViewChange: (view: TutorialView) => void;
  onStateChange: (state: TutorialState) => void;
  onNavigate: (mode: TutorialMode) => void;
  onTourStart: () => void;
  onTourExit: (destination: "restore" | "generate" | "keep") => void;
};

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
}

export function initialTutorialView(state: TutorialState, now = Date.now()): TutorialView {
  return shouldShowTutorialWelcome(state, now) ? "welcome" : "none";
}

export function TutorialExperience({
  view,
  state,
  currentMode,
  onViewChange,
  onStateChange,
  onNavigate,
  onTourStart,
  onTourExit,
}: Props) {
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const steps = tutorialSteps();
  const topics = tutorialTopics();
  const step = steps[state.currentStep] || steps[0];
  const progress = tutorialProgress(state);

  const beginTour = (restart = false) => {
    const next = startTutorial(state, Date.now(), restart);
    onTourStart();
    onStateChange(next);
    onViewChange("tour");
  };

  const pauseTour = () => {
    onTourExit("restore");
    onViewChange("none");
  };

  const finishTour = (openCenter = false) => {
    onStateChange(completeTutorial(state));
    onTourExit(openCenter ? "keep" : "generate");
    onViewChange(openCenter ? "center" : "none");
  };

  const goToStep = (index: number) => {
    const nextIndex = Math.max(0, Math.min(steps.length - 1, index));
    const nextStep = steps[nextIndex];
    onStateChange(advanceTutorial(state, nextIndex));
    if (nextStep.mode) onNavigate(nextStep.mode);
  };

  useEffect(() => {
    if (view !== "tour") return;
    if (step.mode && step.mode !== currentMode) onNavigate(step.mode);
  }, [currentMode, onNavigate, step.mode, view]);

  useEffect(() => {
    if (view !== "tour") return;
    let frame = 0;
    let settleTimer = 0;
    let observer: ResizeObserver | null = null;

    const update = () => {
      const element = step.target ? document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`) : null;
      if (!element) {
        setTargetRect(null);
        setTargetMissing(Boolean(step.target));
        return;
      }
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      settleTimer = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const padding = 10;
        const next = {
          top: Math.max(8, rect.top - padding),
          left: Math.max(8, rect.left - padding),
          right: Math.min(window.innerWidth - 8, rect.right + padding),
          bottom: Math.min(window.innerHeight - 8, rect.bottom + padding),
          width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
          height: Math.min(window.innerHeight - 16, rect.height + padding * 2),
        };
        setTargetRect(next);
        setTargetMissing(false);
        observer = new ResizeObserver(() => frame = requestAnimationFrame(updateRectOnly));
        observer.observe(element);
      }, 240);
    };

    const updateRectOnly = () => {
      const element = step.target ? document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`) : null;
      if (!element) { setTargetRect(null); setTargetMissing(Boolean(step.target)); return; }
      const rect = element.getBoundingClientRect();
      const padding = 10;
      setTargetRect({
        top: Math.max(8, rect.top - padding), left: Math.max(8, rect.left - padding),
        right: Math.min(window.innerWidth - 8, rect.right + padding), bottom: Math.min(window.innerHeight - 8, rect.bottom + padding),
        width: Math.min(window.innerWidth - 16, rect.width + padding * 2), height: Math.min(window.innerHeight - 16, rect.height + padding * 2),
      });
      setTargetMissing(false);
    };

    update();
    const onViewportChange = () => frame = requestAnimationFrame(updateRectOnly);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      observer?.disconnect();
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [currentMode, step.id, step.target, view]);

  // Escape / 方向键导航经共享 hook；Tab 焦点陷阱保留自身逻辑（下方独立监听）。
  useGlobalKeyDown((event) => {
    if (view === "none") return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (view === "tour") pauseTour();
      else if (view === "welcome") {
        onStateChange(postponeTutorial(state));
        onViewChange("none");
      } else onViewChange("none");
      return;
    }
    if (view === "tour" && event.key === "ArrowRight") { event.preventDefault(); goToStep(state.currentStep + 1); return; }
    if (view === "tour" && event.key === "ArrowLeft") { event.preventDefault(); goToStep(state.currentStep - 1); return; }
  }, view !== "none");

  useEffect(() => {
    if (view === "none") return;
    const root = overlayRef.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusItems = focusableElements(root);
    const primaryAction = focusItems.find((item) => item.classList.contains("primary"));
    (primaryAction || focusItems[0])?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusableElements(root);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previous?.focus?.(); };
    // Handlers intentionally follow the current tutorial state.
  }, [state, view]);

  const cardStyle = useMemo<CSSProperties>(() => {
    if (!targetRect || window.innerWidth < 760) return {};
    const width = 360;
    const gap = 22;
    const fitsRight = targetRect.right + gap + width <= window.innerWidth - 18;
    const fitsLeft = targetRect.left - gap - width >= 18;
    const left = fitsRight ? targetRect.right + gap : fitsLeft ? targetRect.left - width - gap : Math.max(18, (window.innerWidth - width) / 2);
    return { left, top: Math.max(18, Math.min(targetRect.top, window.innerHeight - 430)) };
  }, [targetRect]);

  if (view === "none") return null;

  if (view === "welcome") return (
    <div className="tutorial-modal" ref={overlayRef} role="dialog" aria-modal="true" aria-labelledby="tutorial-welcome-title">
      <section className="tutorial-welcome-card">
        <button className="tutorial-close" aria-label={t("稍后再看")} onClick={() => { onStateChange(postponeTutorial(state)); onViewChange("none"); }}><NavIcon name="x" size={18} /></button>
        <span className="tutorial-spark"><NavIcon name="sparkles" size={30} /></span>
        <span className="eyebrow">{t("WELCOME TO IMAGOTUNE")}</span>
        <h2 id="tutorial-welcome-title">{t("用 2–3 分钟熟悉创作流程")}</h2>
        <p>{t("教程会带你查看连接设置、提示词、参考图片、生成队列、图库和本地 AI 工具箱。")}</p>
        <div className="tutorial-privacy"><strong>{t("不会产生费用")}</strong><span>{t("教程只高亮和说明功能，不会生成图片、测试连接、下载模型或读取你的输入。")}</span></div>
        <div className="tutorial-welcome-actions">
          <button className="primary" onClick={() => beginTour(true)}>{t("开始教程")}</button>
          <button className="secondary" onClick={() => { onStateChange(postponeTutorial(state)); onViewChange("none"); }}>{t("24 小时后提醒")}</button>
          <button className="tutorial-text-button" onClick={() => { onStateChange(dismissTutorial(state)); onViewChange("none"); }}>{t("当前教程版本不再提醒")}</button>
        </div>
      </section>
    </div>
  );

  if (view === "center") return (
    <div className="tutorial-modal tutorial-center-modal" ref={overlayRef} role="dialog" aria-modal="true" aria-labelledby="tutorial-center-title">
      <section className="tutorial-center">
        <button className="tutorial-close" aria-label={t("关闭教程中心")} onClick={() => onViewChange("none")}><NavIcon name="x" size={18} /></button>
        <div className="tutorial-center-scroll">
          <div className="tutorial-center-sticky-head"><div className="tutorial-center-head">
            <div><span className="eyebrow">{t("LEARNING CENTER")}</span><h2 id="tutorial-center-title">{t("新手教程中心")}</h2><p>{t("按主题快速了解用途、步骤和常见问题。")}</p></div>
            <div className="tutorial-progress-card"><strong>{progress}%</strong><span>{state.status === "completed" ? t("核心教程已完成") : state.status === "in_progress" ? t("已学习 {current}/{total}", { current: state.currentStep + 1, total: steps.length }) : t("尚未开始核心教程")}</span><i><b style={{ width: `${progress}%` }} /></i></div>
          </div></div>
          <div className="tutorial-topic-grid">
            {topics.map((topic) => <article key={topic.id}>
              <span className="tutorial-topic-icon"><NavIcon name={topic.icon} size={20} /></span>
              <div><h3>{topic.title}</h3><p>{topic.purpose}</p></div>
              <ol>{topic.steps.map((item) => <li key={item}>{item}</li>)}</ol>
              <details><summary>{t("常见问题")}</summary><p>{topic.commonIssue}</p></details>
              <button onClick={() => { onNavigate(topic.mode); onViewChange("none"); }}>{t("前往该功能")}</button>
            </article>)}
          </div>
          <div className="tutorial-center-actions">
            {state.status === "in_progress" && <button className="primary" onClick={() => beginTour(false)}>{t("继续上次进度")}</button>}
            <button className={state.status === "in_progress" ? "secondary" : "primary"} onClick={() => beginTour(true)}>{t("重新开始完整引导")}</button>
            <button className="secondary" onClick={() => onViewChange("none")}>{t("关闭")}</button>
          </div>
        </div>
      </section>
    </div>
  );

  const last = state.currentStep === steps.length - 1;
  return (
    <div className={`tutorial-tour${targetRect ? " has-target" : " is-centered"}`} ref={overlayRef} role="dialog" aria-modal="true" aria-labelledby="tutorial-step-title">
      {targetRect && <>
        <div className="tutorial-shade shade-top" style={{ height: targetRect.top }} />
        <div className="tutorial-shade shade-left" style={{ top: targetRect.top, width: targetRect.left, height: targetRect.height }} />
        <div className="tutorial-shade shade-right" style={{ top: targetRect.top, left: targetRect.right, height: targetRect.height }} />
        <div className="tutorial-shade shade-bottom" style={{ top: targetRect.bottom }} />
        <div className="tutorial-target-guard" style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }} />
        <div className="tutorial-focus-ring" style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }} />
      </>}
      {!targetRect && <div className="tutorial-shade tutorial-shade-full" />}
      <section className="tutorial-step-card" style={cardStyle}>
        <div className="tutorial-step-meta"><span>{t("核心教程")}</span><strong>{state.currentStep + 1} / {steps.length}</strong></div>
        <div className="tutorial-step-progress"><i style={{ width: `${((state.currentStep + 1) / steps.length) * 100}%` }} /></div>
        <h2 id="tutorial-step-title">{step.title}</h2>
        <p>{step.description}</p>
        <div className="tutorial-hint"><span>{t("提示|教程")}</span>{step.hint}</div>
        {targetMissing && <small className="tutorial-fallback-note">{t("当前布局中没有找到目标控件，已切换为居中讲解，你仍可继续教程。")}</small>}
        <div className="tutorial-step-actions">
          {state.currentStep > 0 && <button className="secondary" onClick={() => goToStep(state.currentStep - 1)}>{t("上一步")}</button>}
          {!last ? <button className="primary" onClick={() => goToStep(state.currentStep + 1)}>{t("下一步")}</button> : <>
            <button className="primary" onClick={() => finishTour(false)}>{t("开始创作")}</button>
            <button className="secondary" onClick={() => finishTour(true)}>{t("查看教程中心")}</button>
          </>}
        </div>
        <div className="tutorial-step-footer"><button onClick={pauseTour}>{t("暂停并退出")}</button><button onClick={() => { onStateChange(dismissTutorial(state)); onTourExit("restore"); onViewChange("none"); }}>{t("跳过教程")}</button></div>
        <small className="tutorial-keyboard">{t("← → 切换步骤 · Esc 暂停")}</small>
      </section>
    </div>
  );
}
