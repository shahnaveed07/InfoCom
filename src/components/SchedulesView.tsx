import React, { useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  MapPin,
  Plus,
  User,
  X,
} from 'lucide-react';
import type { DashboardPayload } from '../shared/types';

interface SchedulesViewProps {
  data: DashboardPayload;
  isInstructor: boolean;
  onCreateSession?: (payload: {
    courseId: string;
    cohort: string;
    title: string;
    topic: string;
    room: string;
    startIso: string;
    durationHours: number;
  }) => Promise<number>;
}

export function SchedulesView({
  data,
  isInstructor,
  onCreateSession,
}: SchedulesViewProps) {
  const [filterMode, setFilterMode] = useState<'upcoming' | 'past' | 'all'>(
    'upcoming'
  );
  const [modalOpen, setModalOpen] = useState(false);

  const getCourseCohorts = (targetCourseId: string): string[] => {
    const names = new Set<string>();
    for (const b of data.cohorts) {
      if (b.courseId === targetCourseId && b.status !== 'Archived') {
        names.add(b.name);
      }
    }
    for (const e of data.enrollments) {
      if (e.courseId === targetCourseId && e.cohort) {
        names.add(e.cohort);
      }
    }
    if (names.size === 0) {
      names.add('Cohort A · Autumn');
      names.add('Cohort B · Autumn');
    }
    return Array.from(names);
  };

  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? '');
  const availableCohorts = getCourseCohorts(courseId);
  const [cohort, setCohort] = useState(() => getCourseCohorts(data.courses[0]?.id ?? '')[0] ?? 'Cohort A · Autumn');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [room, setRoom] = useState('Lab 204');
  const [startLocal, setStartLocal] = useState(() => {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  });
  const [durationHours, setDurationHours] = useState('2');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resolvedCohort = availableCohorts.includes(cohort)
    ? cohort
    : availableCohorts[0] ?? 'Cohort A · Autumn';

  function handleCourseChange(nextCourseId: string) {
    setCourseId(nextCourseId);
    const nextCohorts = getCourseCohorts(nextCourseId);
    if (!nextCohorts.includes(cohort)) {
      setCohort(nextCohorts[0] ?? 'Cohort A · Autumn');
    }
  }

  const nowMs = Date.now();
  const filteredSessions = [...data.sessions]
    .filter((s) => {
      const startMs = Date.parse(s.startIso);
      if (filterMode === 'upcoming') return startMs >= nowMs;
      if (filterMode === 'past') return startMs < nowMs;
      return true;
    })
    .sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onCreateSession) return;
    setFormError('');
    if (title.trim().length < 3 || !room.trim() || !startLocal) {
      setFormError('Please provide a session title, room, and start time.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreateSession({
        courseId,
        cohort: resolvedCohort,
        title: title.trim(),
        topic: topic.trim(),
        room: room.trim(),
        startIso: new Date(startLocal).toISOString(),
        durationHours: Number(durationHours) || 2,
      });
      setTitle('');
      setTopic('');
      setModalOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to schedule session.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
          role="group"
          aria-label="Filter class sessions by time"
        >
          {(['upcoming', 'past', 'all'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilterMode(tab)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === tab
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab} Sessions
            </button>
          ))}
        </div>

        {isInstructor && (
          <button
            type="button"
            onClick={() => {
              setFormError('');
              setModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Schedule Class Session</span>
          </button>
        )}
      </div>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Lab & Lecture Timetable
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredSessions.length} sessions
          </span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No {filterMode} sessions found.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredSessions.map((session) => {
              const course = data.courses.find((c) => c.id === session.courseId);
              const start = new Date(session.startIso);
              const end = new Date(session.endIso);
              const hoursUntil = Math.round(
                (start.getTime() - nowMs) / (60 * 60 * 1000)
              );
              const isWithin24h = hoursUntil > 0 && hoursUntil <= 24;

              return (
                <div
                  key={session.id}
                  className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-medium text-blue-700">
                        {course?.code}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{course?.title}</span>
                      <span aria-hidden="true">·</span>
                      <span>{session.cohort}</span>
                      {isWithin24h && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-amber-700">
                            Starts in ~{hoursUntil}h (Reminder Active)
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {session.title}
                    </h3>
                    <p className="text-xs text-slate-600">{session.topic}</p>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 text-xs text-slate-600 shrink-0">
                    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                      <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                      {start.toLocaleDateString('en-IN', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      ·{' '}
                      {start.toLocaleTimeString('en-IN', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}{' '}
                      –{' '}
                      {end.toLocaleTimeString('en-IN', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {session.room}
                    </span>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {session.instructorName}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-modal-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3
                id="session-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Schedule Class Session
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close session modal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              <div>
                <label
                  htmlFor="ses-course"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Course
                </label>
                <select
                  id="ses-course"
                  value={courseId}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                >
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="ses-title"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Session Title
                </label>
                <input
                  id="ses-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. REST Security & Integration Lab"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="ses-topic"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Lab Topic
                </label>
                <input
                  id="ses-topic"
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Key objectives covered in this lab"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="ses-cohort"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Cohort
                  </label>
                  <select
                    id="ses-cohort"
                    value={resolvedCohort}
                    onChange={(e) => setCohort(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  >
                    {availableCohorts.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="ses-room"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Lab / Room
                  </label>
                  <input
                    id="ses-room"
                    type="text"
                    required
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="ses-start"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Start Date & Time
                  </label>
                  <input
                    id="ses-start"
                    type="datetime-local"
                    required
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="ses-duration"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Duration (Hours)
                  </label>
                  <input
                    id="ses-duration"
                    type="number"
                    min={1}
                    max={8}
                    value={durationHours}
                    onChange={(e) => setDurationHours(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {submitting ? 'Scheduling...' : 'Create Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
