import {
  daysUntil,
  formatBytes,
  formatCell,
  formatDuration,
  formatNumber,
  readSource,
} from './format';

describe('format', () => {
  describe('formatBytes', () => {
    it('scales to the largest sensible unit', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1500)).toBe('1.5 kB');
      expect(formatBytes(5_000_000_000)).toBe('5.0 GB');
    });

    it('drops the decimal above a hundred, where it adds nothing', () => {
      expect(formatBytes(250_000)).toBe('250 kB');
    });

    it('treats a negative or non finite size as empty', () => {
      expect(formatBytes(-1)).toBe('0 B');
      expect(formatBytes(Number.NaN)).toBe('0 B');
    });
  });

  describe('formatDuration', () => {
    it('picks the unit matching the magnitude', () => {
      expect(formatDuration(1500)).toBe('1.5 s');
      expect(formatDuration(90_000)).toBe('2 min');
      expect(formatDuration(7_200_000)).toBe('2.0 h');
      expect(formatDuration(259_200_000)).toBe('3.0 days');
    });
  });

  describe('formatNumber', () => {
    it('rounds and groups integers', () => {
      expect(formatNumber(4821.4, 'integer')).toBe((4821).toLocaleString());
      expect(formatNumber(4821, undefined)).toBe((4821).toLocaleString());
    });

    it('renders a ratio as a percentage', () => {
      expect(formatNumber(0.992, 'percent')).toBe('99.2 %');
    });

    it('guards against a non finite value', () => {
      expect(formatNumber(Number.NaN, 'integer')).toBe('—');
    });
  });

  describe('daysUntil', () => {
    it('is negative once the date has passed', () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      expect(daysUntil(yesterday)).toBeLessThan(0);
    });

    it('returns null for an absent or unparsable value', () => {
      expect(daysUntil(null)).toBeNull();
      expect(daysUntil('')).toBeNull();
      expect(daysUntil('not a date')).toBeNull();
    });
  });

  describe('formatCell', () => {
    it('renders an expiry as a relative age', () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      expect(formatCell(yesterday, 'daysUntil')).toMatch(/days ago$/);
    });

    it('joins multi valued properties', () => {
      expect(formatCell(['a', 'b'], 'text')).toBe('a, b');
    });

    it('shows a dash rather than the string "undefined"', () => {
      expect(formatCell(undefined, 'text')).toBe('—');
      expect(formatCell(null, 'date')).toBe('—');
      expect(formatCell('not a number', 'bytes')).toBe('—');
    });
  });

  describe('readSource', () => {
    it('reads a flat property whose name contains a colon', () => {
      expect(readSource({ 'dc:title': 'T' }, 'dc:title')).toBe('T');
    });

    it('walks into the object a complex property is returned as', () => {
      // Shape observed on a live LTS 2025 index: aggregations address the field as
      // `file:content.length`, while _source returns the blob object itself.
      const source = {
        'dc:title': 'cover.docx',
        'file:content': { 'mime-type': 'application/vnd.oasis', length: 57970 },
      };

      expect(readSource(source, 'file:content.length')).toBe(57970);
      expect(readSource(source, 'file:content.mime-type')).toBe('application/vnd.oasis');
    });

    it('still resolves a flat key, should a property name itself contain a dot', () => {
      expect(readSource({ 'file:content.length': 42 }, 'file:content.length')).toBe(42);
    });

    it('returns undefined for a missing path', () => {
      expect(readSource({}, 'a.b.c')).toBeUndefined();
      expect(readSource({ 'file:content': {} }, 'file:content.length')).toBeUndefined();
    });
  });
});
