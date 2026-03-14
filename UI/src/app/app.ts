import { Component, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';
import { TooltipModule } from 'primeng/tooltip';
import { MainComponent } from './main/main';
import { StatsComponent } from './stats/stats';
import { SettingsComponent } from './settings/settings';
import { TrackerService } from './tracker.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, TooltipModule, MainComponent, StatsComponent, SettingsComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {
  private readonly pingStorageKey = 'tracker.pingMs';
  private readonly startOnBootStorageKey = 'tracker.startOnBoot';
  private readonly minimizeToTrayStorageKey = 'tracker.minimizeToTrayOnClose';
  private readonly retentionDaysStorageKey = 'tracker.retentionDays';
  private readonly defaultPingMs = 15000;
  private readonly defaultRetentionDays = 30;

  activeTab = signal<'home' | 'stats' | 'settings'>('home');
  statsPreselectedDate = signal<string | null>(null);
  pingMs = signal<number>(this.readStoredPingMs());
  startOnBoot = signal<boolean>(this.readStoredBoolean(this.startOnBootStorageKey, false));
  minimizeToTrayOnClose = signal<boolean>(this.readStoredBoolean(this.minimizeToTrayStorageKey, false));
  retentionDays = signal<number>(this.readStoredRetentionDays());
  isQuitting = signal<boolean>(false);
  backendConnected = signal<boolean>(true);
  backendError = signal<string>('');

  private healthCheckSub?: Subscription;

  constructor(private tracker: TrackerService) {
    this.loadPersistedSettings();
    this.setupQuittingListener();
    this.startHealthCheck();
  }

  ngOnDestroy(): void {
    this.healthCheckSub?.unsubscribe();
  }

  private startHealthCheck(): void {
    // Check health immediately
    this.checkBackendHealth();

    // Then check every 2 seconds for more responsiveness
    this.healthCheckSub = interval(2000).subscribe(() => {
      this.checkBackendHealth();
    });
  }

  private checkBackendHealth(): void {
    this.tracker.health().subscribe({
      next: () => {
        this.backendConnected.set(true);
        this.backendError.set('');
      },
      error: (err) => {
        this.backendConnected.set(false);
        this.backendError.set('Python Backend not found - Activity tracking is disabled');
      }
    });
  }

  // Public method that other components can call to trigger health check
  public triggerHealthCheck(): void {
    this.checkBackendHealth();
  }

  private setupQuittingListener(): void {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.onAppQuitting) {
      electronAPI.onAppQuitting(() => {
        this.isQuitting.set(true);
      });
    }
  }

  private readStoredPingMs(): number {
    if (typeof window === 'undefined') {
      return this.defaultPingMs;
    }
    const raw = window.localStorage.getItem(this.pingStorageKey);
    const parsed = raw ? Number(raw) : NaN;
    return this.normalizePingMs(parsed);
  }

  private readStoredRetentionDays(): number {
    if (typeof window === 'undefined') {
      return this.defaultRetentionDays;
    }
    const raw = window.localStorage.getItem(this.retentionDaysStorageKey);
    const parsed = raw ? Number(raw) : NaN;
    return this.normalizeRetentionDays(parsed);
  }

  private readStoredBoolean(key: string, fallback: boolean): boolean {
    if (typeof window === 'undefined') {
      return fallback;
    }
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return raw === 'true';
  }

  private store(key: string, value: string): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  }

  private normalizeRetentionDays(value: number): number {
    if (!Number.isFinite(value)) {
      return this.defaultRetentionDays;
    }
    return Math.max(1, Math.round(value));
  }

  private normalizePingMs(value: number): number {
    if (!Number.isFinite(value)) {
      return this.defaultPingMs;
    }
    return Math.max(500, Math.round(value));
  }

  private async loadPersistedSettings(): Promise<void> {
    const electronAPI = (window as any).electronAPI;
    const persisted = await electronAPI?.readSettings?.();
    if (persisted && typeof persisted === 'object') {
      if (typeof persisted.pingMs === 'number') {
        this.pingMs.set(this.normalizePingMs(persisted.pingMs));
      }
      if (typeof persisted.startOnBoot === 'boolean') {
        this.startOnBoot.set(persisted.startOnBoot);
      }
      if (typeof persisted.minimizeToTrayOnClose === 'boolean') {
        this.minimizeToTrayOnClose.set(persisted.minimizeToTrayOnClose);
      }
      if (typeof persisted.retentionDays === 'number') {
        this.retentionDays.set(this.normalizeRetentionDays(persisted.retentionDays));
      }
    }

    this.store(this.pingStorageKey, String(this.pingMs()));
    this.store(this.startOnBootStorageKey, String(this.startOnBoot()));
    this.store(this.minimizeToTrayStorageKey, String(this.minimizeToTrayOnClose()));
    this.store(this.retentionDaysStorageKey, String(this.retentionDays()));

    this.applyElectronSettings();
    this.applyRetentionSettings();
    this.persistElectronSettings();
  }

  private applyElectronSettings(): void {
    (window as any).electronAPI?.setStartOnBoot?.(this.startOnBoot());
    (window as any).electronAPI?.setMinimizeToTrayOnClose?.(this.minimizeToTrayOnClose());
  }

  private applyRetentionSettings(): void {
    this.tracker.setRetentionDays(this.retentionDays()).subscribe();
  }

  private debugSettingsApplied(): void {
    const payload = {
      pingMs: this.pingMs(),
      startOnBoot: this.startOnBoot(),
      minimizeToTrayOnClose: this.minimizeToTrayOnClose(),
      retentionDays: this.retentionDays(),
      at: new Date().toISOString(),
    };
    (window as any).electronAPI?.logSettingsApplied?.(payload);
  }

  private persistElectronSettings(): void {
    const payload = {
      pingMs: this.pingMs(),
      startOnBoot: this.startOnBoot(),
      minimizeToTrayOnClose: this.minimizeToTrayOnClose(),
      retentionDays: this.retentionDays(),
    };
    (window as any).electronAPI?.updateSettings?.(payload);
  }

  updatePingMs(value: number): void {
    const normalized = this.normalizePingMs(value);
    this.pingMs.set(normalized);
    this.store(this.pingStorageKey, String(normalized));
    this.persistElectronSettings();
    this.debugSettingsApplied();
  }

  updateStartOnBoot(value: boolean): void {
    const enabled = Boolean(value);
    this.startOnBoot.set(enabled);
    this.store(this.startOnBootStorageKey, String(enabled));
    (window as any).electronAPI?.setStartOnBoot?.(enabled);
    this.persistElectronSettings();
    this.debugSettingsApplied();
  }

  updateMinimizeToTrayOnClose(value: boolean): void {
    const enabled = Boolean(value);
    this.minimizeToTrayOnClose.set(enabled);
    this.store(this.minimizeToTrayStorageKey, String(enabled));
    (window as any).electronAPI?.setMinimizeToTrayOnClose?.(enabled);
    this.persistElectronSettings();
    this.debugSettingsApplied();
  }

  updateRetentionDays(value: number): void {
    const normalized = this.normalizeRetentionDays(value);
    this.retentionDays.set(normalized);
    this.store(this.retentionDaysStorageKey, String(normalized));
    this.tracker.setRetentionDays(normalized).subscribe();
    this.persistElectronSettings();
    this.debugSettingsApplied();
  }

  navigateToStats(date: string): void {
    this.statsPreselectedDate.set(date);
    this.activeTab.set('stats');
  }

  minimizeWindow(): void {
    (window as any).electronAPI?.minimizeWindow?.();
  }

  closeWindow(): void {
    (window as any).electronAPI?.closeWindow?.();
  }
}
