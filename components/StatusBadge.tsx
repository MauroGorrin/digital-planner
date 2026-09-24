import { STATUS_COLORS, STATUS_LABELS, type ContentStatus } from '@/types/database';

export function StatusBadge({ status, className = '' }: { status: ContentStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status]} ${className}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
