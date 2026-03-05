import { Component, signal } from '@angular/core';
import { MainComponent } from './main/main';
import { StatsComponent } from './stats/stats';
import { SettingsComponent } from './settings/settings';

@Component({
  selector: 'app-root',
  imports: [MainComponent, StatsComponent, SettingsComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly pingStorageKey = 'tracker.pingMs';
  private readonly defaultPingMs = 15000;

  activeTab = signal<'home' | 'stats' | 'settings'>('home');
  pingMs = signal<number>(this.readStoredPingMs());

  updatePingMs(value: number): void {
    const normalized = this.normalizePingMs(value);
    this.pingMs.set(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(this.pingStorageKey, String(normalized));
    }
  }

  minimizeWindow(): void {
    (window as any).electronAPI?.minimizeWindow?.();
  }

  closeWindow(): void {
    (window as any).electronAPI?.closeWindow?.();
  }

  private readStoredPingMs(): number {
    if (typeof window === 'undefined') {
      return this.defaultPingMs;
    }
    const raw = window.localStorage.getItem(this.pingStorageKey);
    const parsed = raw ? Number(raw) : NaN;
    return this.normalizePingMs(parsed);
  }

  private normalizePingMs(value: number): number {
    if (!Number.isFinite(value)) {
      return this.defaultPingMs;
    }
    return Math.max(500, Math.round(value));
  }
}
