const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

export interface Mention {
  id: number;
  source: string;
  source_raw: string;
  title: string | null;
  content: string | null;
  url: string | null;
  published_at: string | null;
  author: string | null;
  engagement: number | null;
  created_at: string;
}

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface MentionsResponse {
  data: Mention[];
  pagination: Pagination;
}

export interface StatsBucket {
  group: string;
  label?: string;
  count: number;
}

export interface StatsResponse {
  group_by: 'source' | 'day';
  data: StatsBucket[];
  missing_published_at?: number;
}

export class ApiUnavailableError extends Error {}

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
  } catch {
    throw new ApiUnavailableError(
      `Could not reach the API at ${API_BASE_URL}. Is the backend running?`,
    );
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'error' in body
        ? ((body as { error: { message?: string } }).error.message ?? 'Unknown API error')
        : `API responded ${response.status}`;
    throw new ApiUnavailableError(message);
  }

  return (await response.json()) as T;
}

export interface MentionFilters {
  q?: string;
  source?: string;
  from?: string;
  to?: string;
  page?: number;
}

export function buildQuery(filters: MentionFilters, pageSize: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.source) params.set('source', filters.source);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('page', String(filters.page ?? 1));
  params.set('page_size', String(pageSize));
  return params.toString();
}

export const getMentions = (query: string) => request<MentionsResponse>(`/mentions?${query}`);
export const getSourceStats = () => request<StatsResponse>('/mentions/stats?group_by=source');
export const getDayStats = () => request<StatsResponse>('/mentions/stats?group_by=day');
