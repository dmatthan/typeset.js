/** Small pieces of the interface's English. */

/** A count with its noun: "1 note", "3 notes". */
export const count = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** When, as a note's card says it: "Today", "Yesterday", else the day ("12 Nov", and the
 *  year when it is not this one's), in the reader's own calendar. */
export function when(at: number, now = Date.now()): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(at)) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const year = new Date(at).getFullYear() !== new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
  }).format(at);
}
