import { Platform } from 'react-native';

import type { Session, User } from '@supabase/supabase-js';
import { Role, UserProfile } from '../types';
import { supabase } from './supabase';

export type LoginCredential = {
  email: string;
  password: string;
  role: Role;
  name: string;
  ward: string;
};

// Update this list with your final judge/demo credentials.
export const LOGIN_CREDENTIALS: LoginCredential[] = [
  {
    email: 'citizen@maduraimakkal.app',
    password: 'Citizen@123',
    role: 'citizen',
    name: 'Madurai Citizen',
    ward: 'Ward 12'
  },
  {
    email: 'worker@maduraimakkal.app',
    password: 'Worker@123',
    role: 'worker',
    name: 'Sanitation Worker',
    ward: 'Ward 12'
  },
  {
    email: 'admin@maduraimakkal.app',
    password: 'Admin@123',
    role: 'admin',
    name: 'City Admin',
    ward: 'HQ'
  }
];

const nowIso = (): string => new Date().toISOString();

const normalizeEmail = (input: string): string => input.trim().toLowerCase();

const roleFromEmail = (email: string): Role => {
  if (email.includes('admin')) {
    return 'admin';
  }
  if (email.includes('worker')) {
    return 'worker';
  }
  return 'citizen';
};

const toProfile = (
  id: string,
  email: string,
  role: Role,
  name: string,
  ward: string,
  deviceId: string
): UserProfile => ({
  id,
  email,
  role,
  name,
  ward,
  deviceId,
  createdAt: nowIso()
});

const mapSupabaseUserToProfile = (user: User): UserProfile => {
  const meta = user.user_metadata as {
    name?: string;
    ward?: string;
    device_id?: string;
    role?: Role;
  };

  const email = user.email ?? '';

  return {
    id: user.id,
    email,
    role: meta?.role ?? roleFromEmail(email),
    name: meta?.name ?? 'Civic User',
    ward: meta?.ward ?? 'Ward 0',
    deviceId: meta?.device_id ?? `${Platform.OS}-unknown`,
    createdAt: user.created_at ?? nowIso()
  };
};

export const loginWithEmailPassword = async (
  emailInput: string,
  password: string,
  deviceId: string
): Promise<{ ok: boolean; profile?: UserProfile; sessionToken?: string; error?: string }> => {
  const email = normalizeEmail(emailInput);
  const pwd = password.trim();

  if (!email || !pwd) {
    return { ok: false, error: 'Email and password are required.' };
  }

  // Always allow demo credentials for fast role switching in presentations.
  const localMatch = LOGIN_CREDENTIALS.find(
    (item) => item.email === email && item.password === pwd
  );

  // Fast path: if demo credentials match, do not wait for network auth.
  if (localMatch) {
    return {
      ok: true,
      profile: toProfile(
        `demo-${localMatch.role}-001`,
        localMatch.email,
        localMatch.role,
        localMatch.name,
        localMatch.ward,
        deviceId
      ),
      sessionToken: `demo-session-${Date.now().toString(36)}`
    };
  }

  if (!supabase) {
    return { ok: false, error: 'Invalid credentials.' };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pwd
  });

  if (!error && data.user && data.session) {
    const profile = await ensureUserProfile(
      data.user,
      email,
      data.user.user_metadata?.name ?? 'Civic User',
      data.user.user_metadata?.ward ?? 'Ward 0',
      (data.user.user_metadata?.role as Role) ?? roleFromEmail(email),
      deviceId
    );

    return {
      ok: true,
      profile,
      sessionToken: data.session.access_token
    };
  }

  return { ok: false, error: error?.message ?? 'Invalid credentials.' };
};

export const getSessionProfile = async (): Promise<{
  session: Session | null;
  profile: UserProfile | null;
}> => {
  if (!supabase) {
    return { session: null, profile: null };
  }

  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) {
    return { session: null, profile: null };
  }

  const email = data.session.user.email ?? '';
  const profile = await fetchOrCreateProfile(
    data.session.user.id,
    email,
    `${Platform.OS}-unknown`
  );

  return { session: data.session, profile };
};

export const signOut = async (): Promise<void> => {
  if (!supabase) {
    return;
  }
  await supabase.auth.signOut();
};

const ensureUserProfile = async (
  user: User,
  email: string,
  name: string,
  ward: string,
  role: Role,
  deviceId: string
): Promise<UserProfile> => {
  if (!supabase) {
    return mapSupabaseUserToProfile(user);
  }

  const payload = {
    id: user.id,
    phone_number: email,
    name: name || 'Civic User',
    ward: ward || 'Ward 0',
    device_id: deviceId,
    created_at: nowIso()
  };

  const { error } = await supabase.from('users').upsert(payload, {
    onConflict: 'id'
  });

  if (error) {
    return mapSupabaseUserToProfile(user);
  }

  return {
    id: user.id,
    email,
    role,
    name: payload.name,
    ward: payload.ward,
    deviceId,
    createdAt: payload.created_at
  };
};

const fetchOrCreateProfile = async (
  userId: string,
  email: string,
  deviceId: string
): Promise<UserProfile> => {
  if (!supabase) {
    return {
      id: userId,
      email,
      role: roleFromEmail(email),
      name: 'Civic User',
      ward: 'Ward 0',
      deviceId,
      createdAt: nowIso()
    };
  }

  const { data } = await supabase
    .from('users')
    .select('id, phone_number, name, ward, device_id, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (!data) {
    const fallback = {
      id: userId,
      phone_number: email,
      name: 'Civic User',
      ward: 'Ward 0',
      device_id: deviceId,
      created_at: nowIso()
    };

    await supabase.from('users').upsert(fallback, { onConflict: 'id' });

    return {
      id: fallback.id,
      email,
      role: roleFromEmail(email),
      name: fallback.name,
      ward: fallback.ward,
      deviceId: fallback.device_id,
      createdAt: fallback.created_at
    };
  }

  const storedEmail = data.phone_number || email;

  return {
    id: data.id,
    email: storedEmail,
    role: roleFromEmail(storedEmail),
    name: data.name,
    ward: data.ward,
    deviceId: data.device_id,
    createdAt: data.created_at
  };
};
