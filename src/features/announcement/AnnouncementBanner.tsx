import { Icon } from '../../components/Icon.tsx';
import { useStore } from '../../state/useStore.ts';
import { announcementStore, dismissAnnouncement, dismissedStore } from './announcement.ts';

export function AnnouncementBanner() {
  const announcement = useStore(announcementStore, (a) => a);
  const dismissedAt = useStore(dismissedStore, (d) => d);
  if (!announcement || announcement.updatedAt <= dismissedAt) return null;
  const { linkUrl, linkLabel } = announcement;
  const external = linkUrl ? /^https?:\/\//i.test(linkUrl) : false;
  return (
    <div className="announcement" role="status" data-tone={announcement.tone ?? 'info'}>
      <p>
        <span className="announcement-label">From the organizer</span>
        <span>
          {announcement.message}
          {linkUrl ? (
            <>
              {' '}
              <a href={linkUrl} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {linkLabel || 'Open'}
              </a>
            </>
          ) : null}
        </span>
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
