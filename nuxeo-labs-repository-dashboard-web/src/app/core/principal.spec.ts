import { canonicalPrincipal, parsePrincipal, principalForms } from './principal';

/*
 * These two forms are not an anomaly of one server: `nt:actors` has no resolver, so the platform
 * writes whatever the workflow node produced. Within a single ParallelDocumentReview instance,
 * "Choose Participants" stores a bare name (it assigns `workflowInitiator`) while "Give Opinion"
 * stores a prefixed one (it assigns a variable fed by Web UI's prefixed picker).
 */
describe('principal', () => {
  describe('parsePrincipal', () => {
    it('reads a bare value as a user, as UserManagerResolver does', () => {
      expect(parsePrincipal('jdoe')).toEqual({ group: false, name: 'jdoe' });
    });

    it('strips either prefix', () => {
      expect(parsePrincipal('user:jdoe')).toEqual({ group: false, name: 'jdoe' });
      expect(parsePrincipal('group:sales')).toEqual({ group: true, name: 'sales' });
    });

    it('leaves a colon that is not a known prefix alone', () => {
      // A login may be an email address; nothing there is a prefix.
      expect(parsePrincipal('jane@acme.com')).toEqual({ group: false, name: 'jane@acme.com' });
      expect(parsePrincipal('domain:jdoe')).toEqual({ group: false, name: 'domain:jdoe' });
    });
  });

  describe('canonicalPrincipal', () => {
    it('brings both forms of a user onto one key', () => {
      expect(canonicalPrincipal('Josh')).toBe('Josh');
      expect(canonicalPrincipal('user:Josh')).toBe('Josh');
    });

    /*
     * The prefix exists precisely to tell apart a user and a group sharing a name — a real
     * customer case. Collapsing a group onto its bare name would undo that.
     */
    it('keeps a group distinct from a user of the same name', () => {
      expect(canonicalPrincipal('group:sales')).toBe('group:sales');
      expect(canonicalPrincipal('sales')).toBe('sales');
      expect(canonicalPrincipal('group:sales')).not.toBe(canonicalPrincipal('sales'));
    });
  });

  describe('principalForms', () => {
    // Mirrors TaskActorsHelper.getTaskActors(), which the platform feeds to `nt:actors/* IN ?`.
    it('searches both forms of a user', () => {
      expect(principalForms('Josh').sort()).toEqual(['Josh', 'user:Josh']);
      expect(principalForms('user:Josh').sort()).toEqual(['Josh', 'user:Josh']);
    });

    it('searches both forms of a group too, as the platform does', () => {
      expect(principalForms('group:sales').sort()).toEqual(['group:sales', 'sales']);
    });
  });
});
