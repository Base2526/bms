export type TableStatus = 'EMPTY' | 'OCCUPIED' | 'CLOSING';

export function tableStatusFor(
  lineCount: number,
  currentStatus: TableStatus | undefined,
): TableStatus {
  if (lineCount === 0) return 'EMPTY';
  return currentStatus === 'CLOSING' ? 'CLOSING' : 'OCCUPIED';
}
