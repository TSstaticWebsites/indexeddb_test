/**
 * Geographic region definitions and utilities for node distribution
 */

export const Regions = {
  NA: 'North America',
  EU: 'Europe',
  AS: 'Asia',
  SA: 'South America',
  AF: 'Africa',
  OC: 'Oceania',
  UN: 'Unknown'
};

export const RegionBounds = {
  NA: { minLat: 15, maxLat: 72, minLng: -168, maxLng: -52 },   // North America
  EU: { minLat: 36, maxLat: 71, minLng: -11, maxLng: 40 },     // Europe
  AS: { minLat: -10, maxLat: 77, minLng: 40, maxLng: 180 },    // Asia
  SA: { minLat: -56, maxLat: 15, minLng: -81, maxLng: -34 },   // South America
  AF: { minLat: -35, maxLat: 37, minLng: -18, maxLng: 52 },    // Africa
  OC: { minLat: -47, maxLat: -10, minLng: 110, maxLng: 180 }   // Oceania
};

/**
 * Get region for given coordinates
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {string} Region identifier
 */
export function getRegionForCoordinates(latitude, longitude) {
  for (const [region, bounds] of Object.entries(RegionBounds)) {
    if (latitude >= bounds.minLat &&
        latitude <= bounds.maxLat &&
        longitude >= bounds.minLng &&
        longitude <= bounds.maxLng) {
      return region;
    }
  }
  return 'UN';
}

/**
 * Check if coordinates are within specified region
 * @param {string} region - Region identifier
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {boolean} Whether coordinates are in region
 */
export function isInRegion(region, latitude, longitude) {
  const bounds = RegionBounds[region];
  if (!bounds) return false;

  return latitude >= bounds.minLat &&
         latitude <= bounds.maxLat &&
         longitude >= bounds.minLng &&
         longitude <= bounds.maxLng;
}

/**
 * Calculate approximate distance between two points
 * @param {number} lat1 - First point latitude
 * @param {number} lon1 - First point longitude
 * @param {number} lat2 - Second point latitude
 * @param {number} lon2 - Second point longitude
 * @returns {number} Distance in kilometers
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
           Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
           Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
