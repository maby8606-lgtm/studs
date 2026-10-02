/**
 * Zone/distance-based delivery fees (Go 2).
 *
 * Each campus has named delivery zones. Every zone sits in a distance band
 * from the campus hub: band 0 = on campus, 1 = near, 2 = far. The delivery
 * fee follows the band, so a Legon → East Legon run costs more than a
 * hall-to-hall drop on campus. Fees are computed SERVER-side from the zone
 * the customer picks — the client never sets its own fee.
 *
 * Band fees (GHS) default to 5 / 8 / 12 and can be tuned with the
 * DELIVERY_FEE_BAND_GHS env var ("5,8,12"). Invalid config fails closed
 * to the defaults — money math never guesses.
 */

export interface DeliveryZone {
  id: string;
  name: string;
  /** 0 = on campus, 1 = near, 2 = far. */
  band: 0 | 1 | 2;
  hint: string;
}

export const DELIVERY_ZONES: Record<string, DeliveryZone[]> = {
  'ug-legon': [
    { id: 'legon-campus', name: 'Legon Campus', band: 0, hint: 'Halls, hostels & lecture areas on campus' },
    { id: 'east-legon', name: 'East Legon', band: 1, hint: 'East Legon & Adjiringanor' },
    { id: 'madina-upsa', name: 'Madina / UPSA', band: 1, hint: 'Madina, Adenta barrier & UPSA area' },
    { id: 'achimota', name: 'Achimota', band: 2, hint: 'Achimota & Dome' },
    { id: 'spintex-tema', name: 'Spintex / Tema', band: 2, hint: 'Spintex Rd & Tema Community 25' },
  ],
  'upsa': [
    { id: 'upsa-campus', name: 'UPSA Campus', band: 0, hint: 'Hostels & lecture areas on campus' },
    { id: 'madina', name: 'Madina', band: 1, hint: 'Madina & Adenta barrier' },
    { id: 'legon', name: 'Legon', band: 1, hint: 'University of Ghana, Legon' },
    { id: 'east-legon', name: 'East Legon', band: 2, hint: 'East Legon & Adjiringanor' },
    { id: 'achimota', name: 'Achimota', band: 2, hint: 'Achimota & Dome' },
  ],
};

export const DEFAULT_BAND_FEES_GHS = [5, 8, 12];

/** Parse DELIVERY_FEE_BAND_GHS ("5,8,12"); fail closed to defaults. */
export function bandFeesFromEnv(raw: string | undefined): number[] {
  if (!raw) return [...DEFAULT_BAND_FEES_GHS];
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0)) {
    return [...DEFAULT_BAND_FEES_GHS];
  }
  return parts;
}

export function zonesForCampus(campusId: string): DeliveryZone[] {
  return DELIVERY_ZONES[campusId] || [];
}

export function findZone(campusId: string, zoneId: string): DeliveryZone | null {
  return zonesForCampus(campusId).find((z) => z.id === zoneId) || null;
}

/** Food-order fee: the delivery zone's distance band sets the price. */
export function foodDeliveryFeeGHS(zone: DeliveryZone, bandFees: number[]): number {
  return bandFees[zone.band];
}

/**
 * P2P fee: priced by the trip itself — the band steps between the pickup
 * and delivery zones (same zone = base fee, one band over = mid, two = far).
 */
export function p2pDeliveryFeeGHS(pickup: DeliveryZone, delivery: DeliveryZone, bandFees: number[]): number {
  const steps = Math.min(Math.abs(pickup.band - delivery.band), 2);
  return bandFees[steps];
}
