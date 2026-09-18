import { PreflightResult } from '../core/preflight.service';

export interface NavItem {
  path: string;
  label: string;
  /** Inline SVG path data, so the app ships no icon font. */
  icon: string;
  /** Preflight feature required to enable the entry. */
  requires?: keyof PreflightResult['features'];
  /** Shown but disabled when the required feature is missing. */
  disabledHint?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: '/content',
    label: 'Content',
    requires: 'repository',
    icon: 'M4 5a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z',
  },
  {
    path: '/process',
    label: 'Process',
    requires: 'workflow',
    disabledHint: 'Requires the workflow audit passthrough',
    icon: 'M4 6h6v4H4V6Zm10 8h6v4h-6v-4ZM7 10v4h7M4 14h6v4H4v-4Z',
  },
  {
    path: '/governance',
    label: 'Governance',
    requires: 'retention',
    disabledHint: 'Requires the nuxeo-retention addon',
    icon: 'M12 3 4 6v5c0 4.5 3.2 8.7 8 10 4.8-1.3 8-5.5 8-10V6l-8-3Z',
  },
  {
    path: '/diagnostics',
    label: 'Diagnostics',
    icon: 'M12 8v4m0 4h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
  },
];
