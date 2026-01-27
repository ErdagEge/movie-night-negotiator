'use client';

import { type Dispatch, type SetStateAction } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Button, Card } from './ui';

type Candidate = { id: string; title: string; created_at: string; added_by: string | null };

export function RankingList({
  order,
  setOrder,
  cands,
  isHost,
  saveRanking,
  saving,
  saveMsg,
  note,
  onDeleteCandidate,
}: {
  order: string[];
  setOrder: Dispatch<SetStateAction<string[]>>;
  cands: Candidate[];
  isHost: boolean;
  saveRanking: () => void;
  saving: boolean;
  saveMsg: string | null;
  note: string | null;
  onDeleteCandidate?: (cid: string) => void;
}) {
  const byId = new Map(cands.map(c => [c.id, c]));

  function move(idx: number, dir: -1 | 1) {
    setOrder(prev => {
      const next = prev.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    if (source.index === destination.index) return;
    setOrder(prev => {
      const next = prev.slice();
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      return next;
    });
  }

  return (
    <Card title="Your ranking" subtitle="Drag to reorder; keyboard ↑/↓ works too" frost={false}>
      {!order.length && <div className="text-gray-500">No items to rank yet</div>}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="rankingList" direction="vertical">
          {(dropProvided) => (
            <ul ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-1">
              {order.map((cid, idx) => {
                const c = byId.get(cid);
                if (!c) return null;
                return (
                  <Draggable key={cid} draggableId={cid} index={idx}>
                    {(dragProvided, snapshot) => (
                      <li
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                        style={dragProvided.draggableProps.style}
                        className={`flex items-center gap-2 rounded border px-3 py-2 transition
                          ${snapshot.isDragging ? 'shadow-md ring-1 ring-black/10 bg-white/70 dark:bg-zinc-900/70' : ''}`}
                      >
                        <span className="px-1 text-gray-500 select-none" aria-hidden>
                          ≡
                        </span>
                        <span className="text-sm text-gray-600 w-8">#{idx + 1}</span>
                        <span className="flex-1">{c.title}</span>
                        <div className="flex gap-1">
                          <Button onClick={() => move(idx, -1)}>↑</Button>
                          <Button onClick={() => move(idx, +1)}>↓</Button>
                          {isHost && onDeleteCandidate && (
                            <Button onClick={() => onDeleteCandidate(cid)} title="Delete for everyone (host)">
                              🗑
                            </Button>
                          )}
                        </div>
                      </li>
                    )}
                  </Draggable>
                );
              })}
              {dropProvided.placeholder}
            </ul>
          )}
        </Droppable>
      </DragDropContext>

      <div className="mt-3">
        <Button onClick={saveRanking} disabled={saving || !order.length}>
          {saving ? 'Saving…' : 'Save ranking'}
        </Button>
        {saveMsg && <span className="ml-3 text-green-400">{saveMsg}</span>}
        {note && <span className="ml-3 text-gray-400">{note}</span>}
      </div>
    </Card>
  );
}
