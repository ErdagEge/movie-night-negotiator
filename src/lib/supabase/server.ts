import { cookies } from 'next/headers';
import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';

// Note: async because cookies() returns a Promise in Next 15
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          // cookieStore may be typed as Readonly; cast to any to allow set in route handlers
          (cookieStore as any).set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          (cookieStore as any).set({ name, value: '', ...options });
        },
      },
    }
  );
}
