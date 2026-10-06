import { ReactNode, useEffect, useRef, useState } from "react";
import Icon, { IconName } from "./Icon";

/** A button that opens a small dropdown list of actions. */
export default function Menu({ label, icon, children, variant = "btn" }: { label: string; icon?: IconName; children: (close: () => void) => ReactNode; variant?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={variant} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {icon && <Icon name={icon} size={16} />}<span>{label}</span><Icon name="chevronDown" size={14} />
      </button>
      {open && <div className="menu" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}
