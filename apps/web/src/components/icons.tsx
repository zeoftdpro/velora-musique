import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => <Icon {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></Icon>;
export const PauseIcon = (p: IconProps) => (
  <Icon {...p}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></Icon>
);
export const NextIcon = (p: IconProps) => <Icon {...p}><path d="M5 5v14l10-7z" fill="currentColor" stroke="none" /><path d="M18 5v14" strokeWidth={2.5} /></Icon>;
export const PrevIcon = (p: IconProps) => <Icon {...p}><path d="M19 5v14L9 12z" fill="currentColor" stroke="none" /><path d="M6 5v14" strokeWidth={2.5} /></Icon>;
export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p}><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.3 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.6.8-1.4 2.3-2.6 4.4-2.6 3.6 0 5.4 3.8 3.8 6.9C19 15.6 12 20 12 20z" fill={filled ? 'currentColor' : 'none'} /></Icon>
);
export const HomeIcon = (p: IconProps) => <Icon {...p}><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></Icon>;
export const SearchIcon = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>;
export const LibraryIcon = (p: IconProps) => <Icon {...p}><path d="M4 4v16M9 4v16M14 4.5l5 15.5" /></Icon>;
export const PlusIcon = (p: IconProps) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const MoreIcon = (p: IconProps) => <Icon {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></Icon>;
export const VolumeIcon = ({ level, ...p }: IconProps & { level: number }) => (
  <Icon {...p}>
    <path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor" stroke="none" />
    {level === 0 ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6" />}
    {level > 0.5 && <path d="M18.5 6.5a8 8 0 0 1 0 11" />}
  </Icon>
);
export const UserIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></Icon>;
export const TrashIcon = (p: IconProps) => <Icon {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Icon>;
export const UpIcon = (p: IconProps) => <Icon {...p}><path d="M6 15l6-6 6 6" /></Icon>;
export const DownIcon = (p: IconProps) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>;
export const MinimizeIcon = (p: IconProps) => <Icon {...p}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></Icon>;
export const MaximizeIcon = (p: IconProps) => <Icon {...p}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></Icon>;
export const DownloadIcon = (p: IconProps) => <Icon {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
export const VideoIcon = (p: IconProps) => <Icon {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5l5-3v9l-5-3z" /></Icon>;
export const EyeOffIcon = (p: IconProps) => <Icon {...p}><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.5 7.6C4.3 9.1 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>;
export const ListPlusIcon = (p: IconProps) => <Icon {...p}><path d="M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6" /></Icon>;
export const CloseIcon = (p: IconProps) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const ShuffleIcon = (p: IconProps) => <Icon {...p}><path d="M16 4h4v4M20 4l-6.5 6.5M4 20l6-6M16 20h4v-4M20 20L4 4" /></Icon>;
export const RepeatIcon = ({ one, ...p }: IconProps & { one?: boolean }) => (
  <Icon {...p}>
    <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />
    {one && <text x="12" y="14.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="currentColor" stroke="none">1</text>}
  </Icon>
);
export const PanelIcon = (p: IconProps) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Icon>;
export const QueueIcon = (p: IconProps) => <Icon {...p}><path d="M4 6h16M4 12h16M4 18h10M18 16l3 2-3 2z" /></Icon>;
export const MusicIcon = (p: IconProps) => <Icon {...p}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></Icon>;
export const LogoMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="velora-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#60a5fa" />
        <stop offset="1" stopColor="#2563eb" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#velora-logo)" />
    <path d="M9 9.5l7 14 7-14" stroke="white" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
