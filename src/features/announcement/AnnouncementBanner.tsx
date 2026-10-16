import { Icon } from '../../components/Icon.tsx';
import { useStore } from '../../state/useStore.ts';
import { announcementStore, dismissAnnouncement, dismissedStore } from './announcement.ts';

export function AnnouncementBanner() {
  const announcement = useStore(announcementStore, (a) => a);
  const dismissedAt = useStore(dismissedStore, (d) => d);
  if (!announcement || announcement.updatedAt <= dismissedAt) return null;
  return (
    <div className="announcement" role="status">
      <p>
        <span className="announcement-label">From the organizer</span>
        {announcement.message}
      </p>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss announcement"
        onClick={() => dismissAnnouncement(announcement.updatedAt)}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
