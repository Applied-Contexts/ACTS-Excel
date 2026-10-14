export type Cell = string | number | boolean | null | Cell[] | { [key: string]: Cell };
export type Column = { name: string; type: string };
export type Page = {
  kind: string;
  title: string;
  result_id?: string;
  table?: string;
  columns: Column[];
  rows: Cell[][];
  total: number;
  offset: number;
  notes: string[];
  path?: string;
};
export type ReplyOptions = { max_chars?: number; full?: boolean; response_format?: 'markdown' | 'json' };
export type Envelope = Page & {
  count: number;
  next_offset: number | null;
  elided: { row: number; column: string; chars: number }[];
  budget: { max_chars: number; used_chars: number; rows_deferred: number; recovery?: string };
};
