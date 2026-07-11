"use client"

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

interface RankingSelectProps {
  /** Current ordered ranking (defaults to the provided options order). */
  value: string[]
  onChange: (next: string[]) => void
}

export function RankingSelect({ value, onChange }: RankingSelectProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = value.indexOf(String(active.id))
    const newIndex = value.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(value, oldIndex, newIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={value} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-2.5">
          {value.map((option, index) => (
            <SortableRow key={option} id={option} label={option} rank={index + 1} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({ id, label, rank }: { id: string; label: string; rank: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded border bg-ink-0 px-4 py-3.5 ${
        isDragging ? "border-ink-900 shadow-sm" : "border-ink-200"
      }`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mauve-100 text-caption font-medium text-ink-900">
        {rank}
      </span>
      <span className="flex-1 text-body-sm text-ink-900">{label}</span>
      <button
        type="button"
        aria-label={`拖动以重新排序 ${label}`}
        className="cursor-grab touch-none rounded p-1 text-ink-400 hover:bg-mauve-50 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <DragHandleIcon />
      </button>
    </li>
  )
}

function DragHandleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="4" r="1" fill="currentColor" />
      <circle cx="10" cy="4" r="1" fill="currentColor" />
      <circle cx="6" cy="8" r="1" fill="currentColor" />
      <circle cx="10" cy="8" r="1" fill="currentColor" />
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="10" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}
