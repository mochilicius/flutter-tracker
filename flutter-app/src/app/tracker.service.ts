import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API = 'http://127.0.0.1:8000';

export interface Category {
  name: string;
  apps: string[];
}

export interface DonutSegment {
  color: string;
  offset: number;
  length: number;
  category: string;
  seconds: number;
}

export interface Rule {
  process: string;
  category: string;
}

export interface ProcessInfo {
  exe: string;
  name: string;
}

export interface Totals {
  date: string;
  totals_seconds: Record<string, number>;
  app_totals_seconds: Record<string, number>;
  active_process: string;
}

export interface AllDailyTotals {
  daily_totals_seconds: Record<string, Record<string, number>>;
  daily_app_totals_seconds: Record<string, Record<string, number>>;
  daily_hourly_seconds: Record<string, Record<string, number[]>>;
  category_colors: Record<string, string>;
}

export interface RetentionSettingsBody {
  retention_days: number;
}

export interface ImportStateBody {
  state: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class TrackerService {
  constructor(private http: HttpClient) {}

  health(): Observable<{ status: string }> {
    return this.http.get<{ status: string }>(`${API}/health`);
  }

  getRules(): Observable<Rule[]> {
    return this.http.get<Rule[]>(`${API}/rules`);
  }

  addRule(process_name: string, category: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/rules`, { process_name, category });
  }

  deleteRule(process_name: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${API}/rules/${encodeURIComponent(process_name)}`);
  }

  getProcesses(): Observable<ProcessInfo[]> {
    return this.http.get<ProcessInfo[]>(`${API}/processes`);
  }

  getTotals(): Observable<Totals> {
    return this.http.get<Totals>(`${API}/totals`);
  }

  getDailyTotals(): Observable<AllDailyTotals> {
    return this.http.get<AllDailyTotals>(`${API}/daily-totals`);
  }

  setRetentionDays(days: number): Observable<{ ok: boolean; retention_days: number }> {
    return this.http.post<{ ok: boolean; retention_days: number }>(`${API}/settings/retention-days`, {
      retention_days: days,
    });
  }

  reloadCache(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/settings/reload-cache`, {});
  }

  importState(state: Record<string, unknown>): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/settings/import-state`, { state });
  }

  exportState(): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${API}/settings/export-cache`);
  }

  clearData(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/settings/clear-data`, {});
  }

  clearTimeData(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/settings/clear-time-data`, {});
  }

  getCategoryColors(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${API}/category-colors`);
  }

  setCategoryColor(category: string, color: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API}/category-colors`, { category, color });
  }

  getAppIcon(exeName: string): Observable<{ data_url: string }> {
    return this.http.get<{ data_url: string }>(`${API}/app-icon/${encodeURIComponent(exeName)}`);
  }
}
