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

@Injectable({ providedIn: 'root' })
export class TrackerService {
  constructor(private http: HttpClient) {}

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
}
