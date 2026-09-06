import { formatAgorot } from '@/lib/money'

export function Price({ agorot, className }: { agorot: number; className?: string }) {
  return <span className={className}>{formatAgorot(agorot)}</span>
}
