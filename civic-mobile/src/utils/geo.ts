import { Coordinates } from '../types';

const EARTH_RADIUS_METERS = 6371000;

const toRadians = (value: number): number => (value * Math.PI) / 180;

export const distanceMeters = (from: Coordinates, to: Coordinates): number => {
  const dLatitude = toRadians(to.latitude - from.latitude);
  const dLongitude = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const a =
    Math.sin(dLatitude / 2) * Math.sin(dLatitude / 2) +
    Math.sin(dLongitude / 2) *
      Math.sin(dLongitude / 2) *
      Math.cos(fromLat) *
      Math.cos(toLat);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

export const formatMeters = (value: number): string => `${Math.round(value)}m`;

export const hotspotKey = (coords: Coordinates): string => {
  const latCell = (Math.round(coords.latitude * 200) / 200).toFixed(3);
  const lngCell = (Math.round(coords.longitude * 200) / 200).toFixed(3);
  return `${latCell}, ${lngCell}`;
};
