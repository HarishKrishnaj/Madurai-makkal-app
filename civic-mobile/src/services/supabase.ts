import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          'x-app-id': 'madurai-makkal-connect-mobile'
        }
      }
    })
  : null;

export const withSupabase = async <T>(
  execute: (client: SupabaseClient) => Promise<T>,
  fallback: T
): Promise<T> => {
  if (!supabase) {
    return fallback;
  }

  try {
    return await execute(supabase);
  } catch {
    return fallback;
  }
};
