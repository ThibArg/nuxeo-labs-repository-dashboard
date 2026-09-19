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
    /*
     * Not gated on the audit feature, for the same reason as Governance: the page itself names
     * what is missing, which a greyed out entry cannot do.
     */
    path: '/users',
    label: 'Users',
    icon: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm13 15v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75',
  },
  {
    /*
     * Deliberately not gated on the retention feature: the page itself names the missing package
     * and links to its documentation, which a disabled entry could never do. Its record and legal
     * hold figures also read core fields that exist without the addon.
     */
    path: '/governance',
    label: 'Governance',
    icon: 'M12 3 4 6v5c0 4.5 3.2 8.7 8 10 4.8-1.3 8-5.5 8-10V6l-8-3Z',
  },
  {
    path: '/diagnostics',
    label: 'Diagnostics',
    icon: 'M12 8v4m0 4h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z',
  },
];
