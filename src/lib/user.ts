import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

// Next 15: cookies() is async
export async function getOrSetClientUserId(): Promise<string> {
  const store = await cookies();
  let id = store.get('mn_uid')?.value;
  if (!id) {
    id = randomUUID();
    // mark HttpOnly to avoid client-side JS access; server APIs will read it
    (store as any).set({
      name: 'mn_uid',
      value: id,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365 // 1 year
    });
  }
  return id;
}
