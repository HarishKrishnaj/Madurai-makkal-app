import * as Location from 'expo-location';

import { LocationSnapshot, LocationStrength } from '../types';

const nowIso = (): string => new Date().toISOString();

export const PREFERRED_ACCURACY_METERS = 5;
export const MAX_ALLOWED_ACCURACY_METERS = 10;
export const MAX_LOCATION_AGE_SECONDS = 30;

const resolveStrength = (accuracyMeters: number): LocationStrength => {
  if (accuracyMeters <= PREFERRED_ACCURACY_METERS) {
    return 'strong';
  }
  if (accuracyMeters <= MAX_ALLOWED_ACCURACY_METERS) {
    return 'medium';
  }
  if (accuracyMeters <= 40) {
    return 'weak';
  }
  return 'none';
};

export const requestLocationPermission = async (): Promise<{
  granted: boolean;
  error?: string;
}> => {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (permission.status !== 'granted') {
    return {
      granted: false,
      error: 'Location access is required to continue.'
    };
  }

  return { granted: true };
};

export const getHighAccuracyLocation = async (): Promise<{
  snapshot?: LocationSnapshot;
  error?: string;
}> => {
  const permission = await requestLocationPermission();
  if (!permission.granted) {
    return { error: permission.error };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
      mayShowUserSettingsDialog: true
    });

    const timestamp =
      typeof position.timestamp === 'number'
        ? new Date(position.timestamp).toISOString()
        : nowIso();

    const accuracyMeters = Math.max(position.coords.accuracy ?? 999, 0);
    const ageSeconds = Math.max((Date.now() - new Date(timestamp).getTime()) / 1000, 0);

    const snapshot: LocationSnapshot = {
      location: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      },
      accuracyMeters,
      timestamp,
      ageSeconds,
      isMocked: Boolean((position.coords as { mocked?: boolean }).mocked),
      strength: resolveStrength(accuracyMeters)
    };

    if (snapshot.isMocked) {
      return { error: 'Fake GPS detected. Action blocked.' };
    }

    if (snapshot.accuracyMeters > MAX_ALLOWED_ACCURACY_METERS) {
      return {
        snapshot,
        error: 'Move to an open area for better GPS accuracy.'
      };
    }

    return { snapshot };
  } catch {
    return { error: 'Failed to fetch location. Try again.' };
  }
};

export const isLocationFresh = (snapshot: LocationSnapshot): boolean =>
  snapshot.ageSeconds <= MAX_LOCATION_AGE_SECONDS;
