import { PageLoadingSkeleton } from '@/components/common/page-loading-skeleton';

export default function Loading() {
  return <PageLoadingSkeleton variant="list" rows={12} />;
}
