import { Card } from './ui';

export type Member = { user_id: string; role: string; nickname: string | null; joined_at?: string };

export function LobbyMembers({
  members,
  onlineIds,
}: {
  members: Member[];
  onlineIds: Set<string>;
}) {
  return (
    <Card title="Members" subtitle="Who’s here">
      {!members.length && <div className="text-gray-500">Nobody here yet</div>}
      <ul className="space-y-1">
        {members.map(m => (
          <li key={m.user_id} className="flex items-center justify-between rounded border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={onlineIds.has(m.user_id) ? 'text-green-500' : 'text-gray-400'}>●</span>
              <span>{m.nickname || 'Guest'}</span>
            </div>
            <span className="text-xs uppercase tracking-wide opacity-60">{m.role}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
