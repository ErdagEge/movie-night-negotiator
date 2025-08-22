'use client';

import { useState } from 'react';

export default function Home() {
  const [msg, setMsg] = useState<string>('');

  async function fetchMessage() {
    const res = await fetch('/api/hello');
    const json = await res.json();
    setMsg(json.message ?? JSON.stringify(json));
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full p-6 space-y-4">
        <h1 className="text-3xl font-bold">🎬 Movie Night Negotiator</h1>
        <p className="text-gray-700">
          Hello! Your app runs. Next we check the database connection.
        </p>
        <button
          onClick={fetchMessage}
          className="rounded-lg border px-3 py-2 hover:bg-gray-50"
        >
          Test DB Connection
        </button>
        {msg && (
          <div className="mt-2 p-3 rounded border bg-gray-50">
            <span className="font-mono">{msg}</span>
          </div>
        )}
      </div>
    </main>
  );
}
