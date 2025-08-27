import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

type ResponseCookie = {
  name: string;
  value: string;
  httpOnly?: boolean;
  path?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  maxAge?: number;
  secure?: boolean;
};

type MutableCookiesObj = {
  get(name: string): { value: string } | undefined;
  set(cookie: ResponseCookie): void;
};

export async function getOrSetClientUserId(): Promise<string> {
  const store = await cookies();
  let id = store.get('mn_uid')?.value;
  if (!id) {
    id = randomUUID();
    const mutable = store as unknown as MutableCookiesObj;
    mutable.set({
      name: 'mn_uid',
      value: id,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return id;
}
