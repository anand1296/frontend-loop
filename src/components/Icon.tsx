/** A handful of 20px stroke icons. Inline SVG: no icon font, no network, themeable via currentColor. */
const PATHS = {
  search: 'M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM13 13l3.5 3.5',
  chevron: 'M7.5 5l5 5-5 5',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  menu: 'M3.5 6h13M3.5 10h13M3.5 14h13',
  close: 'M5 5l10 10M15 5L5 15',
  settings:
    'M10 7.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5ZM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  arrowRight: 'M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5',
  refresh: 'M15.5 8A6 6 0 0 0 4.6 6.2M4.5 3v3.5H8M4.5 12a6 6 0 0 0 10.9 1.8M15.5 17v-3.5H12',
  home: 'M3.5 9.5L10 4l6.5 5.5M5.5 8v8h9V8',
  clock: 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM10 6.5V10l2.5 1.5',
  note: 'M5 3.5h7.5l3 3v10H5zM12.5 3.5v3h3M7.5 10h5M7.5 13h3.5',
  expand: 'M6 8l4 4 4-4',
  collapse: 'M6 12l4-4 4 4',
  shield: 'M10 2.5l6 2.5v4.5c0 3.8-2.6 6.9-6 8-3.4-1.1-6-4.2-6-8V5zM7.5 10l2 2 3.5-4',
  users: 'M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 16.5c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5M13 3.3a3 3 0 0 1 0 5.4M15 12.3c1.6.6 2.5 2 2.5 4.2',
  link: 'M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1',
  code: 'M7 6l-4 4 4 4M13 6l4 4-4 4M11.5 4l-3 12',
  pullRequest:
    'M5.5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5.5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM14.5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5.5 6v8M14.5 14V8a2 2 0 0 0-2-2H9M11 4l-2 2 2 2',
  external: 'M11.5 4h4.5v4.5M16 4l-7 7M14 11.5V16H4V6h4.5',
  megaphone: 'M3.5 8v4h2.5l7 3.5v-11L6 8zM6 12l1 4.5h2.5L8.5 13M16 8.5v3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The brand mark: an open loop with a check, i.e. "a round you've closed". */
export function LoopMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <circle cx="13" cy="13" r="10" fill="none" stroke="var(--line-strong)" strokeWidth="3" />
      <path d="M13 3a10 10 0 0 1 9.4 13.4" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M8.8 13.2l3 3 5.4-6" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
