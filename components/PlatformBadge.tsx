import { PLATFORM_COLORS, PLATFORM_LABELS, FORMAT_LABELS, type PlatformType, type ContentFormat } from '@/types/database';

export function PlatformDot({ platform }: { platform: PlatformType }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: PLATFORM_COLORS[platform] }}
      title={PLATFORM_LABELS[platform]}
    />
  );
}

export function PlatformBadge({ platform, format }: { platform: PlatformType; format?: ContentFormat }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white"
      style={{ backgroundColor: PLATFORM_COLORS[platform] }}
    >
      {PLATFORM_LABELS[platform]}
      {format && <span className="opacity-80">· {FORMAT_LABELS[format]}</span>}
    </span>
  );
}
