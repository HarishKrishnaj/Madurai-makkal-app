import { Bin, RewardCatalogItem, WasteSizeClass } from '../types';

const now = new Date().toISOString();

export const MADURAI_BINS: Bin[] = [
  {
    id: 'bin-001',
    qrCodeId: 'MMC-BIN-001',
    name: 'Periyar Bus Stand Bin Hub',
    ward: 'Ward 12',
    location: { latitude: 9.9166, longitude: 78.1194 },
    status: 'available',
    createdAt: now
  },
  {
    id: 'bin-002',
    qrCodeId: 'MMC-BIN-002',
    name: 'Goripalayam Smart Bin',
    ward: 'Ward 23',
    location: { latitude: 9.9324, longitude: 78.1306 },
    status: 'available',
    createdAt: now
  },
  {
    id: 'bin-003',
    qrCodeId: 'MMC-BIN-003',
    name: 'KK Nagar Community Bin',
    ward: 'Ward 38',
    location: { latitude: 9.8912, longitude: 78.1331 },
    status: 'available',
    createdAt: now
  },
  {
    id: 'bin-004',
    qrCodeId: 'MMC-BIN-004',
    name: 'Mattuthavani Transport Hub Bin',
    ward: 'Ward 45',
    location: { latitude: 9.9287, longitude: 78.1482 },
    status: 'available',
    createdAt: now
  },
  {
    id: 'bin-005',
    qrCodeId: 'MMC-BIN-005',
    name: 'Simmakkal Riverfront Bin',
    ward: 'Ward 9',
    location: { latitude: 9.9255, longitude: 78.1144 },
    status: 'available',
    createdAt: now
  }
];

export const REWARD_CATALOG: RewardCatalogItem[] = [
  {
    id: 'ELECTRICITY_BILL_50',
    title: 'INR50 Electricity Bill Coupon',
    pointsRequired: 100,
    usage: 'Electricity bill payment platforms'
  },
  {
    id: 'WATER_BILL_30',
    title: 'INR30 Water Bill Coupon',
    pointsRequired: 70,
    usage: 'Water bill payment platforms'
  },
  {
    id: 'MOBILE_RECHARGE_25',
    title: 'INR25 Mobile Recharge Coupon',
    pointsRequired: 50,
    usage: 'All major recharge apps'
  },
  {
    id: 'BUS_PASS_20',
    title: 'INR20 Public Transport Coupon',
    pointsRequired: 40,
    usage: 'City transport ticketing apps'
  }
];

export const FIRST_TIME_USER_BONUS_POINTS = 50;

export const REGULAR_REWARD_POINTS: Record<WasteSizeClass, number> = {
  large: 20,
  medium: 10,
  small: 3,
  home_daily: 0
};

export const DISPOSAL_COOLDOWN_HOURS = 2;
