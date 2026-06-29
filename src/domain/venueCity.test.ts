import { describe, it, expect } from 'vitest';
import { normalizeVenue, resolveCity } from './venueCity';

// ---------------------------------------------------------------------------
// normalizeVenue
// ---------------------------------------------------------------------------

describe('normalizeVenue', () => {
  it('lowercases the string', () => {
    expect(normalizeVenue('SoFi Stadium')).toBe('sofi stadium');
  });

  it('strips diacritics', () => {
    // hypothetical accented input; ensures NFD path works
    expect(normalizeVenue('Estàdio')).toBe('estadio');
  });

  it('collapses non-alphanumeric runs to a single space', () => {
    expect(normalizeVenue("Levi's Stadium")).toBe('levi s stadium');
    expect(normalizeVenue('AT&T Stadium')).toBe('at t stadium');
    expect(normalizeVenue('Mercedes-Benz Stadium')).toBe('mercedes benz stadium');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeVenue('  MetLife Stadium  ')).toBe('metlife stadium');
  });

  it('collapses multiple consecutive non-alphanumeric chars to one space', () => {
    expect(normalizeVenue('GEHA  Field -- at -- Arrowhead')).toBe('geha field at arrowhead');
  });
});

// ---------------------------------------------------------------------------
// resolveCity — graceful fallback
// ---------------------------------------------------------------------------

describe('resolveCity — graceful fallback', () => {
  it('returns undefined for null', () => {
    expect(resolveCity(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(resolveCity(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(resolveCity('')).toBeUndefined();
  });

  it('returns undefined for an unrecognised venue', () => {
    expect(resolveCity('Wembley Stadium')).toBeUndefined();
  });

  it('returns undefined for a plausible near-miss that does not match exactly', () => {
    // "MetLife" without "Stadium" is not in the map
    expect(resolveCity('MetLife')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveCity — all 16 host stadiums (canonical names)
// ---------------------------------------------------------------------------

describe('resolveCity — known venues', () => {
  // United States
  it('MetLife Stadium → New York / New Jersey', () => {
    expect(resolveCity('MetLife Stadium')).toBe('New York / New Jersey');
  });

  it('AT&T Stadium → Dallas', () => {
    expect(resolveCity('AT&T Stadium')).toBe('Dallas');
  });

  it('SoFi Stadium → Los Angeles', () => {
    expect(resolveCity('SoFi Stadium')).toBe('Los Angeles');
  });

  it("Levi's Stadium → San Francisco Bay Area", () => {
    expect(resolveCity("Levi's Stadium")).toBe('San Francisco Bay Area');
  });

  it('Gillette Stadium → Boston', () => {
    expect(resolveCity('Gillette Stadium')).toBe('Boston');
  });

  it('Lincoln Financial Field → Philadelphia', () => {
    expect(resolveCity('Lincoln Financial Field')).toBe('Philadelphia');
  });

  it('NRG Stadium → Houston', () => {
    expect(resolveCity('NRG Stadium')).toBe('Houston');
  });

  it('Arrowhead Stadium → Kansas City', () => {
    expect(resolveCity('Arrowhead Stadium')).toBe('Kansas City');
  });

  it('Mercedes-Benz Stadium → Atlanta', () => {
    expect(resolveCity('Mercedes-Benz Stadium')).toBe('Atlanta');
  });

  it('Hard Rock Stadium → Miami', () => {
    expect(resolveCity('Hard Rock Stadium')).toBe('Miami');
  });

  it('Lumen Field → Seattle', () => {
    expect(resolveCity('Lumen Field')).toBe('Seattle');
  });

  // Canada
  it('BC Place → Vancouver', () => {
    expect(resolveCity('BC Place')).toBe('Vancouver');
  });

  it('BMO Field → Toronto', () => {
    expect(resolveCity('BMO Field')).toBe('Toronto');
  });

  // Mexico
  it('Estadio Azteca → Mexico City', () => {
    expect(resolveCity('Estadio Azteca')).toBe('Mexico City');
  });

  it('Estadio BBVA → Monterrey', () => {
    expect(resolveCity('Estadio BBVA')).toBe('Monterrey');
  });

  it('Estadio Akron → Guadalajara', () => {
    expect(resolveCity('Estadio Akron')).toBe('Guadalajara');
  });
});

// ---------------------------------------------------------------------------
// resolveCity — normalization variants
// ---------------------------------------------------------------------------

describe('resolveCity — normalization variants', () => {
  it('is case-insensitive', () => {
    expect(resolveCity('metlife stadium')).toBe('New York / New Jersey');
    expect(resolveCity('METLIFE STADIUM')).toBe('New York / New Jersey');
    expect(resolveCity('Metlife Stadium')).toBe('New York / New Jersey');
  });

  it('handles apostrophe vs no apostrophe in Levi\'s Stadium', () => {
    expect(resolveCity("Levi's Stadium")).toBe('San Francisco Bay Area');
    expect(resolveCity('Levis Stadium')).toBe('San Francisco Bay Area');
  });

  it('handles ATT Stadium (no ampersand) as alias for AT&T Stadium', () => {
    expect(resolveCity('ATT Stadium')).toBe('Dallas');
  });

  it('handles Mercedes Benz Stadium without hyphen', () => {
    expect(resolveCity('Mercedes Benz Stadium')).toBe('Atlanta');
  });

  it('handles the long naming-rights form of Arrowhead Stadium', () => {
    expect(resolveCity('GEHA Field at Arrowhead Stadium')).toBe('Kansas City');
  });

  it('handles BC Place with "Stadium" appended', () => {
    expect(resolveCity('BC Place Stadium')).toBe('Vancouver');
  });

  it('handles former name Estadio Omnilife for Guadalajara', () => {
    expect(resolveCity('Estadio Omnilife')).toBe('Guadalajara');
  });

  it('handles Estadio BBVA Bancomer (former name) for Monterrey', () => {
    expect(resolveCity('Estadio BBVA Bancomer')).toBe('Monterrey');
  });

  it('strips leading/trailing whitespace before lookup', () => {
    expect(resolveCity('  SoFi Stadium  ')).toBe('Los Angeles');
  });
});
