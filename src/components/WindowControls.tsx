import { NavIcon } from "./icons";
import { maximizeAriaLabel, maximizeIconName } from "../lib/window-controls";

interface WindowControlsProps {
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function WindowControls({ maximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  const toggleLabel = maximizeAriaLabel(maximized);
  return (
    <div className="window-controls" role="group" aria-label="窗口控制">
      <button type="button" data-action="minimize" aria-label="最小化窗口" title="最小化" onClick={onMinimize}>
        <NavIcon name="minus" size={12} />
      </button>
      <button type="button" data-action="maximize" aria-label={toggleLabel} title={toggleLabel} onClick={onToggleMaximize}>
        <NavIcon name={maximizeIconName(maximized)} size={12} />
      </button>
      <button type="button" data-action="close" aria-label="关闭窗口" title="关闭" onClick={onClose}>
        <NavIcon name="x" size={12} />
      </button>
    </div>
  );
}
