import { createServerClient as createSupabaseServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type MutableCookies = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieOptions): void;
};

export async function createServerClient() {
  const cookieStore = await cookies();
  const mutable = cookieStore as unknown as MutableCookies;

  return createSupabaseServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        mutable.set(name, value, options);
      },
      remove(name: string, options: CookieOptions) {
        // emulate remove via set with maxAge 0
        mutable.set(name, '', { ...options, maxAge: 0 });
      },
    },
  });
}
