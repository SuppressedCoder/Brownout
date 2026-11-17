/** One icon from Brownout's own set (lib/icons.ts), as inline SVG that takes the text color. */
import { ICONS, type IconName, type IconDef } from '../lib/icons';

export function Icon({ name, size = 14, className = '', title }: { name: IconName; size?: number; className?: string; title?: string }) {
  const d: IconDef = ICONS[name];
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {d.fill?.map((p, i) => (
        <path key={`f${i}`} d={p} fill="currentColor" stroke="none" />
      ))}
      {d.stroke?.map((p, i) => (
        <path key={`s${i}`} d={p} />
      ))}
    </svg>
  );
}

/** The small "opens a menu" mark after a label. */
export function Caret() {
  return <Icon name="chevronDown" size={10} className="caret-icon" />;
}
