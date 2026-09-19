export interface CapturedDownload {
  filename: string;
  /** Null when the file was handed over as a data URL rather than as a blob. */
  blob: Blob | null;
  /** The `href` the anchor carried, which is the data URL itself for a PNG. */
  href: string;
}

export interface DownloadCapture {
  readonly files: CapturedDownload[];
  restore(): void;
}

/**
 * Captures what `core/export` hands to the browser.
 *
 * jsdom implements neither `URL.createObjectURL` nor a navigation for `download`, so a test would
 * otherwise see an anchor being clicked and nothing else. Both are replaced here rather than the
 * export functions themselves, so what is asserted is the file a browser would actually receive.
 */
export function captureDownloads(): DownloadCapture {
  const files: CapturedDownload[] = [];
  const blobs = new Map<string, Blob>();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;

  let counter = 0;
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:captured/${counter++}`;
    blobs.set(url, blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement): void {
    files.push({
      filename: this.download,
      blob: blobs.get(this.href) ?? null,
      href: this.href,
    });
  };

  return {
    files,
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
    },
  };
}

/**
 * Text of a captured file.
 *
 * No byte order mark to strip: `Blob.text()` runs the UTF-8 decode algorithm, which removes one by
 * definition. A test that needs to prove the mark was written has to read the bytes.
 */
export async function textOf(file: CapturedDownload): Promise<string> {
  return (await file.blob?.text()) ?? '';
}
