// Minimal terminal-flavored icon set — 1.5 stroke, 24 viewbox.
const PATHS: Record<string, React.ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5V11z" />,
  folder: <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V6.5z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chat: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.2c-.5.4-.8.1-.8-.4V6.5z" />,
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" />
    </>
  ),
  branch: (
    <>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="8" r="2.2" />
      <path d="M6.5 8.2v7.6M17.5 10.2c0 3.3-3 4.3-6 4.8" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h7.5L19 9v10A1.5 1.5 0 0 1 17.5 20.5h-11A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6.5 3.5z" />
      <path d="M13.5 3.5V9H19" />
    </>
  ),
  play: <path d="M7.5 5.2c0-.8.9-1.3 1.6-.9l9.5 6c.6.4.6 1.3 0 1.7l-9.5 6c-.7.4-1.6 0-1.6-.9V5.2z" />,
  chevronL: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  chevronR: <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  send: <path d="M12 19V6M6.5 11.5L12 5.5l5.5 6" />,
  refresh: <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5" />,
  external: <path d="M9 5H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V15M14 4h6v6M20 4l-9 9" />,
  bell: <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2.5h-15L6 16zM10 21h4" />,
  trash: <path d="M5 7h14M10 7V5h4v2M8 7l.7 12.3a1.5 1.5 0 0 0 1.5 1.2h3.6a1.5 1.5 0 0 0 1.5-1.2L16 7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  spark: <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />,
  diff: <path d="M8 4v8M4 8h8M4 17h8M16 4l4 4-4 4M16 12v8" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M8 11l4 4 4-4" />
      <path d="M5 19.5h14" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V4M8.5 7.5L12 4l3.5 3.5" />
      <path d="M7.5 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 17.5 11h-1" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  workflow: (
    <>
      <rect x="3.5" y="4" width="7" height="5" rx="1.3" />
      <rect x="13.5" y="10" width="7" height="5" rx="1.3" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.3" />
      <path d="M10.5 6.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5M10.5 18h1.5a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5v5h3.2L12 18.5V5.5L7.2 9.5H4z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M4 9.5v5h3.2L12 18.5V5.5L7.2 9.5H4z" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </>
  ),
};

export default function Icon({
  name,
  size = 20,
  className = '',
  strokeWidth = 1.6,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
