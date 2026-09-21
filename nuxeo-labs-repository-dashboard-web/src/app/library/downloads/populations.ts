/**
 * What the audit records when a blob leaves the server.
 *
 * `download` is audited out of the box — `DownloadService.EVENT_NAME`, routed by the platform's
 * own `audit-contrib.xml` with no property to set — and it is the only signal there is. It is also
 * fired by far more than a reader saving a file: every thumbnail and every preview the interface
 * asks for fires one too. Measured on a working repository, 524 of 539 entries were renditions.
 *
 * So no population here is merely `eventId: download`. Each names the reason as well, and the
 * screen shows both figures side by side rather than presenting either of them as "downloads".
 *
 * Three things this cannot see, whatever the reason. `HEAD` requests are not logged at all, nor is
 * the `webengine` reason, which is how an operation result comes back. A partial range is logged
 * only when it starts at zero, so a resumed transfer leaves no trace while a video streamed in
 * segments leaves exactly one. And a `nxbigblob` download carries no `docUUID` and no `docType`,
 * so the breakdowns lose those rows in silence — which is why the tiles are counts of events and
 * only the breakdowns are qualified.
 */
import { Predicate, anyOf, equals } from '../predicates';

/**
 * Every `download` entry, whatever fired it.
 *
 * Deliberately not charted on its own anywhere: a figure counting thumbnails beside one counting
 * files would be two answers to the same question, and the reader has no way to tell which is
 * which. Kept as the common part of the two populations below.
 */
export const DOWNLOAD_EVENTS: Predicate[] = [equals('eventId', 'download')];

/** A reader saving a file: the reason `DownloadServiceImpl` writes for a direct download. */
export const FILE_DOWNLOADS: Predicate[] = [
  ...DOWNLOAD_EVENTS,
  equals('extended.downloadReason', 'download'),
];

/**
 * A thumbnail or a preview the interface asked for, which measures browsing rather than reading.
 *
 * Two reasons rather than one: `PreviewAdapter` writes `preview`, while a rendition writes
 * `rendition` through the request attribute. They are the same event to a reader of the screen.
 */
export const RENDITIONS_SERVED: Predicate[] = [
  ...DOWNLOAD_EVENTS,
  anyOf('extended.downloadReason', ['rendition', 'preview']),
];
