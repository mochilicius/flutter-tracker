import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { Button } from 'primeng/button';
import { TrackerService } from '../tracker.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  imports: [FormsModule, InputNumberModule, Button],
})
export class SettingsComponent {
  private _pingValue = 15000;
  private _startOnBoot = false;
  private _minimizeToTrayOnClose = false;
  private _retentionDays = 30;
  private toastTimer?: ReturnType<typeof setTimeout>;

  readonly statusMessage = signal<string | null>(null);

  @Output() pingValueChange = new EventEmitter<number>();
  @Output() startOnBootChange = new EventEmitter<boolean>();
  @Output() minimizeToTrayOnCloseChange = new EventEmitter<boolean>();
  @Output() retentionDaysChange = new EventEmitter<number>();

  constructor(private tracker: TrackerService) {}

  @Input() set pingValue(value: number) {
    this._pingValue = this.normalizePingMs(value);
  }

  get pingValue(): number {
    return this._pingValue;
  }

  @Input() set startOnBoot(value: boolean) {
    this._startOnBoot = Boolean(value);
  }

  get startOnBoot(): boolean {
    return this._startOnBoot;
  }

  @Input() set minimizeToTrayOnClose(value: boolean) {
    this._minimizeToTrayOnClose = Boolean(value);
  }

  get minimizeToTrayOnClose(): boolean {
    return this._minimizeToTrayOnClose;
  }

  @Input() set retentionDays(value: number) {
    this._retentionDays = this.normalizeRetentionDays(value);
  }

  get retentionDays(): number {
    return this._retentionDays;
  }

  onPingChange(value: number | null): void {
    const normalized = this.normalizePingMs(value ?? this._pingValue);
    this._pingValue = normalized;
  }

  onRetentionChange(value: number | null): void {
    const normalized = this.normalizeRetentionDays(value ?? this._retentionDays);
    this._retentionDays = normalized;
  }

  onStartOnBootChange(value: boolean): void {
    this._startOnBoot = value;
    this.startOnBootChange.emit(this._startOnBoot);
  }

  onMinimizeToTrayChange(value: boolean): void {
    this._minimizeToTrayOnClose = value;
    this.minimizeToTrayOnCloseChange.emit(this._minimizeToTrayOnClose);
  }

  private normalizePingMs(value: number): number {
    if (!Number.isFinite(value)) {
      return 15000;
    }
    return Math.max(500, Math.round(value));
  }

  private normalizeRetentionDays(value: number): number {
    if (!Number.isFinite(value)) {
      return 30;
    }
    return Math.max(1, Math.round(value));
  }

  applySettings(): void {
    const normalizedPing = this.normalizePingMs(this._pingValue);
    const normalizedRetention = this.normalizeRetentionDays(this._retentionDays);

    this._pingValue = normalizedPing;
    this._retentionDays = normalizedRetention;

    this.pingValueChange.emit(normalizedPing);
    this.startOnBootChange.emit(this._startOnBoot);
    this.minimizeToTrayOnCloseChange.emit(this._minimizeToTrayOnClose);
    this.retentionDaysChange.emit(normalizedRetention);

    this.statusMessage.set(`Settings applied. Ping ${normalizedPing} ms, retention ${normalizedRetention} day(s).`);
    this.queueAutoDismiss();
  }

  reloadCache(): void {
    this.tracker.reloadCache().subscribe({
      next: () => {
        this.statusMessage.set('Cache reloaded from state file. Refreshing...');
        this.queueAutoDismiss();
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
        }, 500);
      },
      error: () => {
        this.statusMessage.set('Failed to reload cache from state file.');
        this.queueAutoDismiss();
      }
    });
  }

  importStateFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    file.text()
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .then((json) => {
        this.tracker.importState(json).subscribe({
          next: (response) => {
            if (!response.ok) {
              this.statusMessage.set('Import failed. Invalid state file.');
              this.queueAutoDismiss();
              return;
            }
            this.statusMessage.set('State imported. Refreshing...');
            this.queueAutoDismiss();
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            }, 500);
          },
          error: () => {
            this.statusMessage.set('Import failed while uploading state file.');
            this.queueAutoDismiss();
          }
        });
      })
      .catch(() => {
        this.statusMessage.set('Selected file is not valid JSON.');
        this.queueAutoDismiss();
      })
      .finally(() => {
        input.value = '';
      });
  }

  private queueAutoDismiss(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      this.statusMessage.set(null);
      this.toastTimer = undefined;
    }, 4500);
  }

  dismissMessage(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }
    this.statusMessage.set(null);
  }
}
