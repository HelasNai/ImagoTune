import { useEffect, useRef, useState } from "react";
import titleImage from "../assets/imagination-title-cropped.png";
import { SPLASH_EXIT_MS, shouldDismissSplash } from "../lib/splash";

// 墨点氛围：固定参数（位置 / 尺寸 / 时序），确定性、可复现；围绕中央字条散布。
const SPLASH_MOTES = [
  { left: "17%", top: "36%", size: 10, delay: 0.2, duration: 4.4 },
  { left: "26%", top: "64%", size: 6, delay: 0.9, duration: 5.2 },
  { left: "38%", top: "28%", size: 4, delay: 0.5, duration: 3.8 },
  { left: "50%", top: "70%", size: 8, delay: 1.1, duration: 4.8 },
  { left: "62%", top: "40%", size: 5, delay: 0.6, duration: 4.2 },
  { left: "74%", top: "62%", size: 9, delay: 1.4, duration: 5.4 },
  { left: "84%", top: "33%", size: 6, delay: 0.3, duration: 4.6 },
];

function readReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 启动页（v3.14）：全屏覆盖层，艺术字「想象变成图片」书写显影 + 墨点氛围。
 * **动画与退场计时都锚定「窗口可见」**：本组件先于窗口显示挂载时（窗口隐藏期间），
 * 动画保持预备态不跑；visibilitychange → visible（窗口一出场）才起笔并开始计时——
 * 否则动画会在隐藏期偷跑（CSS 动画基于文档时间线），用户只看到结尾。
 * ready（启动期数据就绪）且达到最短展示时长后播放退场动画，随后回调 onExited 由父级卸载；
 * reduced-motion 下动画被 CSS 禁用、无最短展示（动画时长与判定见 lib/splash.ts）。
 */
export function SplashScreen({ ready, onExited }: { ready: boolean; onExited: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [reducedMotion] = useState(readReducedMotion);
  // armed = 窗口已可见（动画起跑条件）。生产常态：挂载时窗口已显示 → 立即 armed。
  const [armed, setArmed] = useState(() => document.visibilityState === "visible");
  const startedAtRef = useRef<number | null>(armed ? performance.now() : null);

  // 等待窗口可见后起跑；挂载时恰好已可见则同步 armed（覆盖时序竞态）。
  useEffect(() => {
    if (armed) return;
    const armIfVisible = () => {
      if (document.visibilityState === "visible") {
        startedAtRef.current = performance.now();
        setArmed(true);
      }
    };
    armIfVisible();
    document.addEventListener("visibilitychange", armIfVisible);
    return () => document.removeEventListener("visibilitychange", armIfVisible);
  }, [armed]);

  // 退场判定：armed 后才开始（elapsedMs 自可见时刻起算）；100ms 轮询即可（生命周期仅 ~2s），
  // 判定逻辑在 lib/splash.ts 中锁定。
  useEffect(() => {
    if (!armed || exiting) return;
    const tick = () => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      if (shouldDismissSplash({ ready, elapsedMs: performance.now() - startedAt, reducedMotion })) {
        setExiting(true);
      }
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [armed, exiting, ready, reducedMotion]);

  // 退场动画结束后卸载；reduced-motion 下动画已被禁用，立即卸载。
  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(onExited, reducedMotion ? 0 : SPLASH_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting, onExited, reducedMotion]);

  const className = ["splash", armed ? "splash-armed" : "", exiting ? "splash-exit" : ""].filter(Boolean).join(" ");
  return (
    <div className={className} aria-hidden="true">
      {SPLASH_MOTES.map((mote, index) => (
        <span
          key={index}
          className="splash-mote"
          style={{
            left: mote.left,
            top: mote.top,
            width: mote.size,
            height: mote.size,
            animationDelay: `${mote.delay}s`,
            animationDuration: `${mote.duration}s`,
          }}
        />
      ))}
      <img className="splash-title" src={titleImage} alt="" draggable={false} />
    </div>
  );
}
