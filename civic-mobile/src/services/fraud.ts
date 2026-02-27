import { Coordinates, FraudAlert, FraudAlertType, UserLocationSnapshot } from '../types';
import { distanceMeters } from '../utils/geo';

const LOCATION_SPEED_THRESHOLD_METERS_PER_SECOND = 33.33; // ~120 kmph
const LOCATION_JUMP_THRESHOLD_METERS = 2000;

export const isDuplicateImage = (
  usedImageHashes: string[],
  imageHash: string
): boolean => usedImageHashes.includes(imageHash);

export const isLocationAnomaly = (
  previous: UserLocationSnapshot | undefined,
  currentLocation: Coordinates,
  currentTimestampIso: string
): boolean => {
  if (!previous) {
    return false;
  }

  const previousTime = new Date(previous.timestamp).getTime();
  const currentTime = new Date(currentTimestampIso).getTime();
  const elapsedSeconds = Math.max((currentTime - previousTime) / 1000, 1);
  const travelDistance = distanceMeters(previous.location, currentLocation);
  const speed = travelDistance / elapsedSeconds;

  return (
    speed > LOCATION_SPEED_THRESHOLD_METERS_PER_SECOND ||
    travelDistance > LOCATION_JUMP_THRESHOLD_METERS
  );
};

export const makeFraudAlert = (
  type: FraudAlertType,
  actionId: string,
  message: string,
  severity: FraudAlert['severity'],
  createdAt: string,
  riskScore: number
): FraudAlert => ({
  id: `fraud-${actionId}-${type}`,
  type,
  severity,
  message,
  actionId,
  status: riskScore >= 80 ? 'blocked' : 'open',
  createdAt,
  riskScore
});

const TYPE_SCORE: Record<FraudAlertType, number> = {
  duplicate_image: 40,
  location_anomaly: 50,
  before_after_mismatch: 45,
  qr_mismatch: 20,
  geo_fence_failure: 50,
  mock_location_detected: 50,
  cooldown_violation: 30,
  location_accuracy_failure: 20,
  timestamp_invalid: 20
};

export const fraudRiskScore = (types: FraudAlertType[]): number =>
  types.reduce((sum, item) => sum + TYPE_SCORE[item], 0);
